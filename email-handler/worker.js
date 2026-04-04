/**
 * Email Handler Worker - Enhanced Version
 *
 * Features:
 * - Full HTML email preservation
 * - Attachment support (up to 50MB via R2)
 * - Proper MIME parsing with full UTF-8/emoji support
 * - Structured email storage
 * - Real sender extraction (bypasses SMTP bounce addresses)
 *
 * Required bindings: TEMP_EMAILS (KV), EMAILS (KV), ATTACHMENTS (R2)
 * Add ATTACHMENTS R2 bucket in Cloudflare Pages → Settings → Functions → R2 bindings
 */

export default {
    async email(message, env, ctx) {
        try {
            console.log("========== NEW EMAIL RECEIVED ==========");

            const recipientEmail = message.to;
            console.log("To:", recipientEmail);
            console.log("From (envelope):", message.from);

            // Verify email exists in system (temp emails in TEMP_EMAILS, permanent/saved in EMAILS)
            const tempEmailRecord = await env.TEMP_EMAILS.get(recipientEmail);
            let isPermanentAddress = false;
            if (!tempEmailRecord) {
                const permRecord = await env.EMAILS.get(recipientEmail, { type: 'json' });
                if (!permRecord) {
                    console.log("❌ Email not registered");
                    message.setReject("Address not found");
                    return;
                }
                isPermanentAddress = !!permRecord.isPermanent;
            }

            console.log("✅ Email verified", isPermanentAddress ? "(permanent)" : "(temp)");

            // Read raw email
            const rawEmail = await this.streamToString(message.raw);

            // Parse email components
            const parsedEmail = this.parseEmail(rawEmail, message);

            // Upload attachments to R2 (if binding available) and replace data with r2Key
            for (let i = 0; i < parsedEmail.attachments.length; i++) {
                const att = parsedEmail.attachments[i];
                if (att && att.data && env.ATTACHMENTS) {
                    try {
                        const r2Key = `attachments/${recipientEmail}/${Date.now()}_${i}_${att.filename}`;
                        const binaryData = Uint8Array.from(atob(att.data), c => c.charCodeAt(0));
                        await env.ATTACHMENTS.put(r2Key, binaryData, {
                            httpMetadata: { contentType: att.contentType }
                        });
                        att.r2Key = r2Key;
                        delete att.data; // Don't store base64 in KV — too large
                        console.log("✅ Attachment uploaded to R2:", r2Key);
                    } catch (attErr) {
                        console.log("⚠️ R2 attachment upload failed:", attErr.message);
                        delete att.data; // Remove data even on failure to avoid KV bloat
                    }
                } else if (att && att.data) {
                    // No R2 binding — drop attachment data to avoid KV bloat
                    delete att.data;
                }
            }

            // Create storage object
            const emailData = {
                from: this.extractRealFrom(message),
                to: recipientEmail,
                subject: parsedEmail.subject,
                body: parsedEmail.textBody,
                htmlBody: parsedEmail.htmlBody,
                attachments: parsedEmail.attachments,
                timestamp: Date.now(),
                headers: {
                    messageId: message.headers.get("message-id"),
                    date: message.headers.get("date"),
                    contentType: message.headers.get("content-type"),
                    from: message.headers.get("from"),
                    replyTo: message.headers.get("reply-to")
                }
            };

            // Store in KV — permanent addresses keep messages for 30 days; temp for 1 hour
            const storageKey = `email:${recipientEmail}:${Date.now()}`;
            const ttlSeconds = isPermanentAddress ? 30 * 24 * 3600 : 3600;

            await env.EMAILS.put(
                storageKey,
                JSON.stringify(emailData),
                { expirationTtl: ttlSeconds }
            );

            console.log("✅ Email stored:", storageKey);
            console.log("   Subject:", parsedEmail.subject);
            console.log("   Has HTML:", !!parsedEmail.htmlBody);
            console.log("   Attachments:", parsedEmail.attachments.length);

            // Check for forwarding rule (Premium feature) — stored in EMAILS namespace
            // Uses Cloudflare's native message.forward() — no external API key needed.
            const forwardingKey = `forward:${recipientEmail}`;
            const forwardingRule = await env.EMAILS.get(forwardingKey, { type: 'json' });

            if (forwardingRule && forwardingRule.to) {
                console.log("📨 Forwarding to:", forwardingRule.to);

                try {
                    await message.forward(forwardingRule.to);
                    console.log("✅ Email forwarded successfully");
                } catch (fwdError) {
                    console.log("⚠️ Forward error:", fwdError.message);
                }
            }

            console.log("=========================================");

        } catch (error) {
            console.error("❌ ERROR:", error.message);
            console.error("Stack:", error.stack);
        }
    },

    // Extract the real human-visible From address from email headers.
    // Prefers RFC 5322 From header over SMTP envelope (which may be a bounce address).
    extractRealFrom(message) {
        const fromHeader = message.headers.get("from");
        if (fromHeader && fromHeader.trim()) return fromHeader.trim();

        const replyTo = message.headers.get("reply-to");
        if (replyTo && replyTo.trim()) return replyTo.trim();

        return message.from;
    },

    // Convert stream to string — collects all Uint8Array chunks first, then decodes once
    // to prevent split multi-byte sequences (emoji) from being corrupted at chunk boundaries.
    async streamToString(stream) {
        const reader = stream.getReader();
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }

        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        return new TextDecoder("utf-8").decode(combined);
    },

    // Parse email content
    parseEmail(rawEmail, message) {
        const result = {
            subject: this.decodeEncodedWord(message.headers.get("subject") || "") || "(No Subject)",
            textBody: "",
            htmlBody: "",
            attachments: []
        };

        const contentType = message.headers.get("content-type") || "";

        // Check if multipart
        if (contentType.toLowerCase().includes("multipart")) {
            const boundary = this.extractBoundary(contentType);
            if (boundary) {
                const parts = this.parseMultipart(rawEmail, boundary);

                for (const part of parts) {
                    const partContentType = part.headers["content-type"] || "";
                    const contentDisposition = part.headers["content-disposition"] || "";

                    // Check if attachment
                    if (contentDisposition.includes("attachment") ||
                        (contentDisposition.includes("filename") && !partContentType.includes("text/"))) {
                        const attachment = this.parseAttachment(part);
                        if (attachment && attachment.size <= 50 * 1024 * 1024) { // 50MB limit
                            result.attachments.push(attachment);
                        }
                    }
                    // HTML content
                    else if (partContentType.includes("text/html")) {
                        result.htmlBody = this.decodeContent(part.body, part.headers["content-transfer-encoding"]);
                    }
                    // Plain text
                    else if (partContentType.includes("text/plain")) {
                        result.textBody = this.decodeContent(part.body, part.headers["content-transfer-encoding"]);
                    }
                    // Nested multipart
                    else if (partContentType.includes("multipart")) {
                        const nestedBoundary = this.extractBoundary(partContentType);
                        if (nestedBoundary) {
                            const nestedParts = this.parseMultipart(part.body, nestedBoundary);
                            for (const nestedPart of nestedParts) {
                                const nestedType = nestedPart.headers["content-type"] || "";
                                if (nestedType.includes("text/html") && !result.htmlBody) {
                                    result.htmlBody = this.decodeContent(nestedPart.body, nestedPart.headers["content-transfer-encoding"]);
                                } else if (nestedType.includes("text/plain") && !result.textBody) {
                                    result.textBody = this.decodeContent(nestedPart.body, nestedPart.headers["content-transfer-encoding"]);
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Simple email
            const parts = rawEmail.split(/\r?\n\r?\n/);
            if (parts.length >= 2) {
                const body = parts.slice(1).join("\n\n");
                const encoding = message.headers.get("content-transfer-encoding");

                if (contentType.includes("text/html")) {
                    result.htmlBody = this.decodeContent(body, encoding);
                } else {
                    result.textBody = this.decodeContent(body, encoding);
                }
            }
        }

        // Fallback if no text body
        if (!result.textBody && result.htmlBody) {
            result.textBody = this.stripHtml(result.htmlBody);
        }

        // Limit sizes
        if (result.textBody.length > 50000) {
            result.textBody = result.textBody.substring(0, 50000) + "\n\n[Truncated]";
        }
        if (result.htmlBody.length > 100000) {
            result.htmlBody = result.htmlBody.substring(0, 100000);
        }

        return result;
    },

    // Extract boundary from content-type
    extractBoundary(contentType) {
        const match = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
        return match ? match[1] : null;
    },

    // Parse multipart content
    parseMultipart(content, boundary) {
        const parts = [];
        const delimiter = "--" + boundary;
        const sections = content.split(delimiter);

        for (let i = 1; i < sections.length; i++) {
            const section = sections[i];

            if (section.trim() === "--" || section.trim() === "") continue;

            const headerEnd = section.search(/\r?\n\r?\n/);
            if (headerEnd === -1) continue;

            const headerSection = section.substring(0, headerEnd);
            const bodySection = section.substring(headerEnd).replace(/^\r?\n\r?\n/, "").replace(/\r?\n--$/, "").trim();

            const headers = {};
            const headerLines = headerSection.split(/\r?\n/);
            let currentHeader = "";

            for (const line of headerLines) {
                if (line.match(/^\s+/)) {
                    currentHeader += " " + line.trim();
                } else {
                    if (currentHeader) {
                        const colonIndex = currentHeader.indexOf(":");
                        if (colonIndex > 0) {
                            const key = currentHeader.substring(0, colonIndex).toLowerCase().trim();
                            const value = currentHeader.substring(colonIndex + 1).trim();
                            headers[key] = value;
                        }
                    }
                    currentHeader = line;
                }
            }

            if (currentHeader) {
                const colonIndex = currentHeader.indexOf(":");
                if (colonIndex > 0) {
                    const key = currentHeader.substring(0, colonIndex).toLowerCase().trim();
                    const value = currentHeader.substring(colonIndex + 1).trim();
                    headers[key] = value;
                }
            }

            parts.push({ headers, body: bodySection });
        }

        return parts;
    },

    // Parse attachment
    parseAttachment(part) {
        const contentDisposition = part.headers["content-disposition"] || "";
        const contentType = part.headers["content-type"] || "application/octet-stream";

        // Extract filename
        let filename = "attachment";
        const filenameMatch = contentDisposition.match(/filename=["']?([^"';\n]+)["']?/i) ||
            contentType.match(/name=["']?([^"';\n]+)["']?/i);
        if (filenameMatch) {
            filename = filenameMatch[1].trim();
            // Decode if encoded
            if (filename.startsWith("=?")) {
                try {
                    filename = this.decodeEncodedWord(filename);
                } catch (e) { }
            }
        }

        // Get data
        const encoding = part.headers["content-transfer-encoding"] || "";
        let data = part.body;

        // If base64, keep as is (already base64)
        if (encoding.toLowerCase() === "base64") {
            data = data.replace(/\s/g, "");
        } else {
            // Convert to base64
            try {
                data = btoa(data);
            } catch (e) {
                return null;
            }
        }

        const size = Math.ceil(data.length * 0.75); // Approximate decoded size

        return {
            filename: filename,
            contentType: contentType.split(";")[0].trim(),
            size: size,
            data: data
        };
    },

    // Decode content based on encoding
    decodeContent(content, encoding) {
        if (!encoding) return content;

        encoding = encoding.toLowerCase().trim();

        if (encoding === "base64") {
            try {
                const b64 = content.replace(/\s/g, "");
                const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                return new TextDecoder("utf-8").decode(bytes);
            } catch (e) {
                try { return atob(content.replace(/\s/g, "")); } catch (_) { return content; }
            }
        }

        if (encoding === "quoted-printable") {
            return content
                .replace(/=\r?\n/g, "")
                .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        }

        return content;
    },

    // Decode RFC 2047 encoded words (e.g. =?UTF-8?B?...?= or =?UTF-8?Q?...?=)
    decodeEncodedWord(str) {
        if (!str) return str;
        return str.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (match, charset, encoding, text) => {
            if (encoding.toUpperCase() === "B") {
                try {
                    const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
                    return new TextDecoder(charset || "utf-8").decode(bytes);
                } catch (e) {
                    try { return atob(text); } catch (_) { return text; }
                }
            } else if (encoding.toUpperCase() === "Q") {
                return text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
                    String.fromCharCode(parseInt(hex, 16))
                );
            }
            return text;
        });
    },

    // Strip HTML tags
    stripHtml(html) {
        return html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, " ")
            .trim();
    }
};
