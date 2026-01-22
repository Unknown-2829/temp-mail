/**
 * Email Handler Worker - Enhanced Version
 * 
 * Features:
 * - Full HTML email preservation
 * - Attachment support (up to 1MB)
 * - Proper MIME parsing
 * - Structured email storage
 */

export default {
    async email(message, env, ctx) {
        try {
            console.log("========== NEW EMAIL RECEIVED ==========");

            const recipientEmail = message.to;
            console.log("To:", recipientEmail);
            console.log("From:", message.from);

            // Verify email exists in system
            const emailExists = await env.TEMP_EMAILS.get(recipientEmail);

            if (!emailExists) {
                console.log("❌ Email not registered");
                message.setReject("Address not found");
                return;
            }

            console.log("✅ Email verified");

            // Read raw email
            const rawEmail = await this.streamToString(message.raw);

            // Parse email components
            const parsedEmail = this.parseEmail(rawEmail, message);

            // Create storage object
            const emailData = {
                from: message.from,
                to: recipientEmail,
                subject: parsedEmail.subject,
                body: parsedEmail.textBody,
                htmlBody: parsedEmail.htmlBody,
                attachments: parsedEmail.attachments,
                timestamp: Date.now(),
                headers: {
                    messageId: message.headers.get("message-id"),
                    date: message.headers.get("date"),
                    contentType: message.headers.get("content-type")
                }
            };

            // Store in KV
            const storageKey = `email:${recipientEmail}:${Date.now()}`;

            await env.EMAILS.put(
                storageKey,
                JSON.stringify(emailData),
                { expirationTtl: 3600 }
            );

            console.log("✅ Email stored:", storageKey);
            console.log("   Subject:", parsedEmail.subject);
            console.log("   Has HTML:", !!parsedEmail.htmlBody);
            console.log("   Attachments:", parsedEmail.attachments.length);
            console.log("=========================================");

        } catch (error) {
            console.error("❌ ERROR:", error.message);
            console.error("Stack:", error.stack);
        }
    },

    // Convert stream to string
    async streamToString(stream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let result = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            result += decoder.decode(value, { stream: true });
        }
        result += decoder.decode();

        return result;
    },

    // Parse email content
    parseEmail(rawEmail, message) {
        const result = {
            subject: message.headers.get("subject") || "(No Subject)",
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
                        if (attachment && attachment.size <= 1024 * 1024) { // 1MB limit
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
                return atob(content.replace(/\s/g, ""));
            } catch (e) {
                return content;
            }
        }

        if (encoding === "quoted-printable") {
            return content
                .replace(/=\r?\n/g, "")
                .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        }

        return content;
    },

    // Decode RFC 2047 encoded words
    decodeEncodedWord(str) {
        return str.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (match, charset, encoding, text) => {
            if (encoding.toUpperCase() === "B") {
                return atob(text);
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
