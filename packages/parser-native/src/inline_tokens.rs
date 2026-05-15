use serde::Serialize;

// ── Output types (serializable to JSON, mirroring ParsedTextToken union) ─────

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "tokenType")]
pub enum ParsedToken {
    #[serde(rename = "text")]
    Text {
        text: String,
        decoration: String, // "none", "bold", "italic", "strikethrough", "code"
    },
    #[serde(rename = "obsidian_link")]
    ObsidianLink {
        source: String,
        #[serde(rename = "pageTarget")]
        page_target: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        alias: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[serde(rename = "headerName")]
        header_name: Option<String>,
    },
    #[serde(rename = "link")]
    Link {
        href: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
    },
    #[serde(rename = "image")]
    Image {
        src: String,
        alt: String, // ALWAYS present (never Option) — matches TS behavior
    },
    #[serde(rename = "meta_action")]
    MetaAction {
        name: String,
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
    },
    #[serde(rename = "meta_mdtree")]
    MetaMdtree {
        directive: String,
    },
}

// ── Meta extraction (hand-written parsers extending list_scanner patterns) ───

/// Extract all meta-action triples from input, returning cleaned string and tokens.
/// Pattern: (meta-action-name::NAME)(meta-action-url::URL)(meta-action-icon::ICON)?
fn extract_meta_actions(input: &str) -> (String, Vec<ParsedToken>) {
    let mut result = String::with_capacity(input.len());
    let mut tokens = Vec::new();
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'(' && input[i..].starts_with("(meta-action-name::") {
            // Try to match the full triple
            if let Some((end_pos, token)) = try_parse_meta_action_triple(&input[i..]) {
                tokens.push(token);
                i += end_pos;
                continue;
            }
        }
        // Advance one character (handle UTF-8 properly)
        let ch = input[i..].chars().next().unwrap();
        result.push(ch);
        i += ch.len_utf8();
    }

    (result, tokens)
}

/// Try to parse a meta-action triple starting at the current position.
/// Returns (bytes_consumed, token) on success.
fn try_parse_meta_action_triple(s: &str) -> Option<(usize, ParsedToken)> {
    // (meta-action-name::NAME)(meta-action-url::URL)(meta-action-icon::ICON)?
    let prefix_name = "(meta-action-name::";
    if !s.starts_with(prefix_name) {
        return None;
    }

    let mut i = prefix_name.len();
    let bytes = s.as_bytes();
    let len = bytes.len();

    // Capture name: everything until ')'
    let name_start = i;
    while i < len && bytes[i] != b')' {
        i += 1;
    }
    if i >= len {
        return None;
    }
    let name = s[name_start..i].to_string();
    i += 1; // skip ')'

    // Expect (meta-action-url::
    let prefix_url = "(meta-action-url::";
    if !s[i..].starts_with(prefix_url) {
        return None;
    }
    i += prefix_url.len();

    // Capture url: everything until ')'
    let url_start = i;
    while i < len && bytes[i] != b')' {
        i += 1;
    }
    if i >= len {
        return None;
    }
    let url = s[url_start..i].to_string();
    i += 1; // skip ')'

    // Optionally expect (meta-action-icon::
    let prefix_icon = "(meta-action-icon::";
    let icon = if s[i..].starts_with(prefix_icon) {
        i += prefix_icon.len();
        let icon_start = i;
        while i < len && bytes[i] != b')' {
            i += 1;
        }
        if i >= len {
            return None;
        }
        let icon_val = &s[icon_start..i];
        i += 1; // skip ')'
        // Match TS behavior: `icon || undefined` — empty string becomes None (absent)
        if icon_val.is_empty() {
            None
        } else {
            Some(icon_val.to_string())
        }
    } else {
        None
    };

    Some((
        i,
        ParsedToken::MetaAction { name, url, icon },
    ))
}

/// Extract all meta-mdtree directives from input, returning cleaned string and tokens.
/// Pattern: (meta-mdtree::\s*\w+)
fn extract_meta_mdtree(input: &str) -> (String, Vec<ParsedToken>) {
    let mut result = String::with_capacity(input.len());
    let mut tokens = Vec::new();
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'(' && input[i..].starts_with("(meta-mdtree::") {
            if let Some((end_pos, token)) = try_parse_meta_mdtree(&input[i..]) {
                tokens.push(token);
                i += end_pos;
                continue;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        result.push(ch);
        i += ch.len_utf8();
    }

    (result, tokens)
}

/// Try to parse a meta-mdtree directive starting at the current position.
/// Returns (bytes_consumed, token) on success.
fn try_parse_meta_mdtree(s: &str) -> Option<(usize, ParsedToken)> {
    let prefix = "(meta-mdtree::";
    if !s.starts_with(prefix) {
        return None;
    }

    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut i = prefix.len();

    // Skip optional whitespace
    while i < len && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }

    // Capture \w+ (alphanumeric + underscore)
    let word_start = i;
    while i < len && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i == word_start {
        return None; // need at least one word char
    }
    let directive = s[word_start..i].to_string();

    // Expect closing ')'
    if i >= len || bytes[i] != b')' {
        return None;
    }
    i += 1; // skip ')'

    Some((i, ParsedToken::MetaMdtree { directive }))
}

// ── resolveReference logic ──────────────────────────────────────────────────

fn resolve_reference(reference: &str) -> String {
    if reference.contains('/') {
        // TS: ref.split("/")[1] — returns the element at index 1
        let parts: Vec<&str> = reference.split('/').collect();
        if parts.len() > 1 {
            return parts[1].to_string();
        }
    }
    reference.to_string()
}

// ── Inline parsing state machine ────────────────────────────────────────────

/// Parse inline tokens from a text string.
/// This is the main entry point, matching TS `parseTokens`.
pub fn parse_tokens(input: &str) -> Vec<ParsedToken> {
    // Step 1: Extract meta-action triples
    let (cleaned, meta_actions) = extract_meta_actions(input);

    // Step 2: Extract meta-mdtree directives
    let (cleaned, meta_mdtrees) = extract_meta_mdtree(&cleaned);

    // Step 3: Trim
    let cleaned = cleaned.trim();

    if cleaned.is_empty() {
        // Only meta tokens, no inline content
        let mut result = Vec::new();
        result.extend(meta_actions);
        result.extend(meta_mdtrees);
        return result;
    }

    // Step 4: Inline parsing state machine (top-level: position 0 is a word boundary for URLs)
    let inline_tokens = parse_inline(cleaned, true);

    // Step 5: Combine: inline tokens first, then meta-actions, then meta-mdtree
    let mut result = inline_tokens;
    result.extend(meta_actions);
    result.extend(meta_mdtrees);
    result
}

/// Parse the inline content (after meta extraction and trim).
/// Returns a list of inline tokens in document order.
/// `is_top_level` — if true, position 0 counts as a word boundary for URL detection.
/// When false (recursive call from emphasis), position 0 does NOT count as a URL boundary.
/// This matches TS/markdown-it behavior where `inlineHttpLinkPlugin` uses `(^|\s)` on the
/// original source, not on emphasis inner content.
fn parse_inline(input: &str, is_top_level: bool) -> Vec<ParsedToken> {
    let mut tokens = Vec::new();
    let mut text_buf = String::new();
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    // Track whether the last emitted emphasis was bold (**), which requires a trailing text token
    let mut needs_trailing_text_after_bold = false;

    while i < len {
        let b = bytes[i];

        // 1. Inline code (highest priority) — supports multi-backtick spans (`` ` ``, ``` `` ```, etc.)
        if b == b'`' {
            // Count opening backticks
            let backtick_count = count_backticks(bytes, i);
            // Find matching closing backtick sequence of the same count
            if let Some(end) = find_closing_backticks(bytes, i + backtick_count, backtick_count) {
                flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
                let code_content = &input[i + backtick_count..end];
                tokens.push(ParsedToken::Text {
                    text: code_content.to_string(),
                    decoration: "code".to_string(),
                });
                i = end + backtick_count;
                continue;
            }
            // No closing backtick sequence — treat as plain text
            for _ in 0..backtick_count {
                text_buf.push('`');
            }
            i += backtick_count;
            continue;
        }

        // 2. Obsidian links `[[`
        if b == b'[' && i + 1 < len && bytes[i + 1] == b'[' {
            if let Some((end, token)) = try_parse_obsidian_link(input, i) {
                flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
                tokens.push(token);
                i = end;
                continue;
            }
            // Unclosed — treat `[[` as plain text
            text_buf.push('[');
            text_buf.push('[');
            i += 2;
            continue;
        }

        // 3. Images `![` (not `![[`)
        if b == b'!' && i + 1 < len && bytes[i + 1] == b'[' {
            // Check it's NOT `![[` (obsidian embed)
            if i + 2 < len && bytes[i + 2] == b'[' {
                // This is `![[` — the `!` is plain text, `[[...]]` will be parsed as obsidian link
                text_buf.push('!');
                i += 1;
                continue;
            }
            if let Some((end, token)) = try_parse_image(input, i) {
                flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
                tokens.push(token);
                i = end;
                continue;
            }
            // Failed to parse image — treat `![` as plain text
            text_buf.push('!');
            text_buf.push('[');
            i += 2;
            continue;
        }

        // 4. Markdown links `[` (not `[[` and not `![`)
        if b == b'[' && !(i + 1 < len && bytes[i + 1] == b'[') {
            if let Some((end, token)) = try_parse_markdown_link(input, i) {
                flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
                tokens.push(token);
                i = end;
                continue;
            }
            // Failed — treat `[` as plain text
            text_buf.push('[');
            i += 1;
            continue;
        }

        // 5. HTTP URLs
        if (b == b'h') && (input[i..].starts_with("http://") || input[i..].starts_with("https://")) {
            // Check word boundary: preceded by whitespace, OR at position 0 only if top-level.
            // In recursive emphasis parsing, position 0 is NOT a URL boundary (matches TS
            // where inlineHttpLinkPlugin regex `(^|\s)` operates on the original source,
            // not on emphasis inner content).
            let at_boundary = (i == 0 && is_top_level) || (i > 0 && (bytes[i - 1] == b' ' || bytes[i - 1] == b'\t' || bytes[i - 1] == b'\n' || bytes[i - 1] == b'\r'));
            if at_boundary {
                if let Some((end, token)) = try_parse_bare_url(input, i) {
                    flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
                    tokens.push(token);
                    i = end;
                    continue;
                }
            }
        }

        // 6. Bold `**`
        if b == b'*' && i + 1 < len && bytes[i + 1] == b'*' {
            if let Some((end, inner_tokens)) = try_parse_emphasis(input, i, "**") {
                // For bold (**), markdown-it ALWAYS emits a text token before strong_open
                // (even if empty). Force-flush the text buffer regardless of content.
                force_flush_text_buf(&mut text_buf, &mut tokens);
                // Two-token pattern: empty text with decoration, then inner content
                tokens.push(ParsedToken::Text {
                    text: "".to_string(),
                    decoration: "bold".to_string(),
                });
                tokens.extend(inner_tokens);
                // After strong_close, markdown-it ALWAYS has a text token.
                // Mark that we need a trailing text token after bold.
                needs_trailing_text_after_bold = true;
                i = end;
                continue;
            }
            // No closing `**` — treat as plain text
            text_buf.push('*');
            text_buf.push('*');
            i += 2;
            continue;
        }

        // 7. Strikethrough `~~`
        if b == b'~' && i + 1 < len && bytes[i + 1] == b'~' {
            if let Some((end, inner_tokens)) = try_parse_emphasis(input, i, "~~") {
                flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
                tokens.push(ParsedToken::Text {
                    text: "".to_string(),
                    decoration: "strikethrough".to_string(),
                });
                tokens.extend(inner_tokens);
                i = end;
                continue;
            }
            text_buf.push('~');
            text_buf.push('~');
            i += 2;
            continue;
        }

        // 8. Italic `*` (single, not `**`)
        if b == b'*' && !(i + 1 < len && bytes[i + 1] == b'*') {
            if let Some((end, inner_tokens)) = try_parse_emphasis(input, i, "*") {
                flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
                tokens.push(ParsedToken::Text {
                    text: "".to_string(),
                    decoration: "italic".to_string(),
                });
                tokens.extend(inner_tokens);
                i = end;
                continue;
            }
            text_buf.push('*');
            i += 1;
            continue;
        }

        // 8b. Bold `__` or Italic `_` — only at word boundaries (markdown-it rule)
        // _ can open emphasis only when preceded by non-word char or start of string
        if b == b'_' {
            let preceded_by_word = i > 0 && is_word_char(bytes[i - 1]);
            if !preceded_by_word {
                // Try `__` (bold) first
                if i + 1 < len && bytes[i + 1] == b'_' {
                    if let Some((end, inner_tokens)) = try_parse_double_underscore_emphasis(input, i) {
                        // Same text-padding as ** bold
                        force_flush_text_buf(&mut text_buf, &mut tokens);
                        tokens.push(ParsedToken::Text {
                            text: "".to_string(),
                            decoration: "bold".to_string(),
                        });
                        tokens.extend(inner_tokens);
                        needs_trailing_text_after_bold = true;
                        i = end;
                        continue;
                    }
                }
                // Try `_` (italic)
                if let Some((end, inner_tokens)) = try_parse_underscore_emphasis(input, i) {
                    flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
                    tokens.push(ParsedToken::Text {
                        text: "".to_string(),
                        decoration: "italic".to_string(),
                    });
                    tokens.extend(inner_tokens);
                    i = end;
                    continue;
                }
            }
            text_buf.push('_');
            i += 1;
            continue;
        }

        // 9. Softbreak (newline) — markdown-it produces a softbreak token with empty text
        if b == b'\n' {
            flush_text_buf_or_bold_trailing(&mut text_buf, &mut tokens, &mut needs_trailing_text_after_bold);
            tokens.push(ParsedToken::Text {
                text: "".to_string(),
                decoration: "none".to_string(),
            });
            i += 1;
            continue;
        }

        // 10. Plain text — accumulate
        let ch = input[i..].chars().next().unwrap();
        text_buf.push(ch);
        i += ch.len_utf8();
    }

    // Flush remaining text (or trailing bold text)
    if needs_trailing_text_after_bold {
        // After bold, always emit a text token even if empty
        tokens.push(ParsedToken::Text {
            text: text_buf.clone(),
            decoration: "none".to_string(),
        });
        text_buf.clear();
    } else {
        flush_text_buf(&mut text_buf, &mut tokens);
    }

    tokens
}

/// Flush the text buffer as a plain text token if non-empty.
fn flush_text_buf(buf: &mut String, tokens: &mut Vec<ParsedToken>) {
    if !buf.is_empty() {
        tokens.push(ParsedToken::Text {
            text: buf.clone(),
            decoration: "none".to_string(),
        });
        buf.clear();
    }
}

/// Force-flush the text buffer as a plain text token, EVEN IF EMPTY.
/// Used before bold (**) to match markdown-it's behavior of always having
/// a text token before strong_open.
fn force_flush_text_buf(buf: &mut String, tokens: &mut Vec<ParsedToken>) {
    tokens.push(ParsedToken::Text {
        text: buf.clone(),
        decoration: "none".to_string(),
    });
    buf.clear();
}

/// Flush the text buffer when transitioning to a new token.
/// If `needs_trailing_text_after_bold` is true (we're after a bold close),
/// ALWAYS emit a text token (even if empty) to match markdown-it's trailing text behavior.
/// Otherwise, normal flush (skip empty).
fn flush_text_buf_or_bold_trailing(
    buf: &mut String,
    tokens: &mut Vec<ParsedToken>,
    needs_trailing: &mut bool,
) {
    if *needs_trailing {
        // After bold, always emit a text token (even empty)
        tokens.push(ParsedToken::Text {
            text: buf.clone(),
            decoration: "none".to_string(),
        });
        buf.clear();
        *needs_trailing = false;
    } else {
        flush_text_buf(buf, tokens);
    }
}

/// Count consecutive backticks starting at position `start`.
fn count_backticks(bytes: &[u8], start: usize) -> usize {
    let mut count = 0;
    let mut i = start;
    while i < bytes.len() && bytes[i] == b'`' {
        count += 1;
        i += 1;
    }
    count
}

/// Find a closing backtick sequence of exactly `count` backticks.
/// Returns the index of the FIRST backtick of the closing sequence.
fn find_closing_backticks(bytes: &[u8], start: usize, count: usize) -> Option<usize> {
    let mut i = start;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            let run = count_backticks(bytes, i);
            if run == count {
                return Some(i);
            }
            // Skip this run of backticks (wrong count)
            i += run;
        } else {
            i += 1;
        }
    }
    None
}

/// Try to parse an obsidian link `[[...]]` starting at position `start`.
/// Returns (end_position_after_token, token) on success.
fn try_parse_obsidian_link(input: &str, start: usize) -> Option<(usize, ParsedToken)> {
    // start points to the first `[` of `[[`
    let bytes = input.as_bytes();
    let len = bytes.len();
    let content_start = start + 2;

    let mut i = content_start;
    while i + 1 < len {
        if bytes[i] == b']' && bytes[i + 1] == b']' {
            // Found closing `]]`
            let content = &input[content_start..i];
            let source = format!("[[{}]]", content);

            // Parse content: split on `|` for alias, then on `#` for header
            let (with_header, alias) = match content.split_once('|') {
                Some((wh, a)) => (wh, Some(a.to_string())),
                None => (content, None),
            };

            let (file_name, header_name) = match with_header.split_once('#') {
                Some((f, h)) => (f, Some(h.to_string())),
                None => (with_header, None),
            };

            let page_target = resolve_reference(file_name);

            return Some((
                i + 2,
                ParsedToken::ObsidianLink {
                    source,
                    page_target,
                    alias,
                    header_name,
                },
            ));
        }
        i += 1;
    }

    None // No closing `]]`
}

/// Try to parse a markdown image `![alt](src)` starting at position `start`.
/// `start` points to the `!`.
/// Handles balanced parentheses in src URL.
fn try_parse_image(input: &str, start: usize) -> Option<(usize, ParsedToken)> {
    let bytes = input.as_bytes();
    let len = bytes.len();

    // start is at `!`, start+1 is at `[`
    let alt_start = start + 2;
    let mut i = alt_start;

    // Find closing `]`
    while i < len && bytes[i] != b']' {
        i += 1;
    }
    if i >= len {
        return None;
    }
    let alt = input[alt_start..i].to_string();
    i += 1; // skip `]`

    // Expect `(`
    if i >= len || bytes[i] != b'(' {
        return None;
    }
    i += 1; // skip `(`

    // Find closing `)` with balanced parentheses support
    let src_start = i;
    let mut paren_depth = 1;
    while i < len && paren_depth > 0 {
        match bytes[i] {
            b'(' => paren_depth += 1,
            b')' => paren_depth -= 1,
            _ => {}
        }
        if paren_depth > 0 {
            i += 1;
        }
    }
    if paren_depth != 0 {
        return None;
    }
    let src = input[src_start..i].to_string();
    i += 1; // skip closing `)`

    Some((i, ParsedToken::Image { src, alt }))
}

/// Try to parse a markdown link `[text](url)` starting at position `start`.
/// `start` points to `[`.
///
/// Handles balanced parentheses in URLs (e.g., `[text](url_(thing))`).
/// Rejects URLs that contain spaces (matching markdown-it behavior).
fn try_parse_markdown_link(input: &str, start: usize) -> Option<(usize, ParsedToken)> {
    let bytes = input.as_bytes();
    let len = bytes.len();

    let text_start = start + 1;
    let mut i = text_start;

    // Find closing `]` — but watch out for nested brackets (simple: no nesting)
    while i < len && bytes[i] != b']' {
        i += 1;
    }
    if i >= len {
        return None;
    }
    let content = input[text_start..i].to_string();
    i += 1; // skip `]`

    // Expect `(`
    if i >= len || bytes[i] != b'(' {
        return None;
    }
    i += 1; // skip `(`

    // Find closing `)` with balanced parentheses support
    let href_start = i;
    let mut paren_depth = 1;
    while i < len && paren_depth > 0 {
        match bytes[i] {
            b'(' => paren_depth += 1,
            b')' => paren_depth -= 1,
            b' ' | b'\t' | b'\n' | b'\r' => {
                // URLs with spaces are not valid markdown links
                return None;
            }
            _ => {}
        }
        if paren_depth > 0 {
            i += 1;
        }
    }
    if paren_depth != 0 {
        return None;
    }
    let href = input[href_start..i].to_string();
    i += 1; // skip closing `)`

    Some((
        i,
        ParsedToken::Link {
            href,
            content: Some(content),
        },
    ))
}

/// Try to parse a bare HTTP/HTTPS URL starting at position `start`.
/// Returns (end_position, token) on success.
fn try_parse_bare_url(input: &str, start: usize) -> Option<(usize, ParsedToken)> {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = start;

    // Consume characters matching [^\s\])}>,]+
    while i < len {
        let b = bytes[i];
        if b == b' ' || b == b'\t' || b == b'\n' || b == b'\r'
            || b == b']' || b == b')' || b == b'}' || b == b'>' || b == b','
        {
            break;
        }
        i += 1;
    }

    if i == start {
        return None;
    }

    let url = input[start..i].to_string();
    Some((
        i,
        ParsedToken::Link {
            href: url.clone(),
            content: Some(url),
        },
    ))
}

/// Check if a byte is a "word" character (alphanumeric or underscore).
/// Used for underscore emphasis boundary detection.
#[inline]
fn is_word_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Try to parse underscore emphasis `_..._`.
/// The closing `_` must be followed by a non-word character or end of string.
/// Returns (end_position_after_closing_marker, inner_tokens) on success.
fn try_parse_underscore_emphasis(input: &str, start: usize) -> Option<(usize, Vec<ParsedToken>)> {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let search_start = start + 1; // skip opening `_`

    if search_start >= len {
        return None;
    }

    // Find closing `_`
    let mut i = search_start;
    while i < len {
        if bytes[i] == b'_' {
            // Check that closing `_` is followed by non-word char or end of string
            let followed_by_word = i + 1 < len && is_word_char(bytes[i + 1]);
            if !followed_by_word {
                let inner = &input[search_start..i];

                // Reject empty content or content that starts/ends with space
                if inner.is_empty() {
                    return None;
                }
                let inner_bytes = inner.as_bytes();
                if inner_bytes[0] == b' ' || inner_bytes[0] == b'\t'
                    || inner_bytes[inner_bytes.len() - 1] == b' '
                    || inner_bytes[inner_bytes.len() - 1] == b'\t'
                {
                    return None;
                }

                let inner_tokens = parse_inline(inner, false);
                return Some((i + 1, inner_tokens));
            }
        }
        i += 1;
    }

    None
}

/// Try to parse double underscore emphasis `__...__`.
/// Both opening and closing `__` must be at word boundaries.
/// Returns (end_position_after_closing_marker, inner_tokens) on success.
fn try_parse_double_underscore_emphasis(input: &str, start: usize) -> Option<(usize, Vec<ParsedToken>)> {
    let bytes = input.as_bytes();
    let len = bytes.len();
    let search_start = start + 2; // skip opening `__`

    if search_start >= len {
        return None;
    }

    // Find closing `__`
    let mut i = search_start;
    while i + 1 < len {
        if bytes[i] == b'_' && bytes[i + 1] == b'_' {
            // Check that closing `__` is followed by non-word char or end of string
            let followed_by_word = i + 2 < len && is_word_char(bytes[i + 2]);
            if !followed_by_word {
                let inner = &input[search_start..i];

                // Reject empty content or content that starts/ends with space
                if inner.is_empty() {
                    return None;
                }
                let inner_bytes = inner.as_bytes();
                if inner_bytes[0] == b' ' || inner_bytes[0] == b'\t'
                    || inner_bytes[inner_bytes.len() - 1] == b' '
                    || inner_bytes[inner_bytes.len() - 1] == b'\t'
                {
                    return None;
                }

                let inner_tokens = parse_inline(inner, false);
                return Some((i + 2, inner_tokens));
            }
        }
        i += 1;
    }

    None
}

/// Try to parse emphasis/decoration delimited by `marker` (e.g., `**`, `*`, `_`, `~~`).
/// Returns (end_position_after_closing_marker, inner_tokens) on success.
/// The inner content is parsed recursively for inline tokens.
///
/// Rejects emphasis if:
/// - Inner content is empty
/// - Inner content starts or ends with whitespace (matching markdown-it behavior)
fn try_parse_emphasis(input: &str, start: usize, marker: &str) -> Option<(usize, Vec<ParsedToken>)> {
    let marker_len = marker.len();
    let search_start = start + marker_len;
    let bytes = input.as_bytes();
    let len = bytes.len();

    if search_start >= len {
        return None;
    }

    // Find the closing marker
    let marker_bytes = marker.as_bytes();
    let mut i = search_start;
    while i + marker_len <= len {
        if &bytes[i..i + marker_len] == marker_bytes {
            // Found closing marker
            let inner = &input[search_start..i];

            // Reject empty content or content that starts/ends with space
            if inner.is_empty() {
                return None;
            }
            let inner_bytes = inner.as_bytes();
            if inner_bytes[0] == b' ' || inner_bytes[0] == b'\t'
                || inner_bytes[inner_bytes.len() - 1] == b' '
                || inner_bytes[inner_bytes.len() - 1] == b'\t'
            {
                return None;
            }

            // Parse inner content recursively
            let inner_tokens = parse_inline(inner, false);
            return Some((i + marker_len, inner_tokens));
        }
        i += 1;
    }

    None // No closing marker found
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Obsidian link parsing (10 tests) ────────────────────────────────────

    #[test]
    fn test_simple_obsidian_link() {
        let result = parse_tokens("[[Note]]");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::ObsidianLink {
                source: "[[Note]]".to_string(),
                page_target: "Note".to_string(),
                alias: None,
                header_name: None,
            }
        );
    }

    #[test]
    fn test_obsidian_link_with_alias() {
        let result = parse_tokens("[[Note|Display]]");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::ObsidianLink {
                source: "[[Note|Display]]".to_string(),
                page_target: "Note".to_string(),
                alias: Some("Display".to_string()),
                header_name: None,
            }
        );
    }

    #[test]
    fn test_obsidian_link_with_header() {
        let result = parse_tokens("[[Note#Section]]");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::ObsidianLink {
                source: "[[Note#Section]]".to_string(),
                page_target: "Note".to_string(),
                alias: None,
                header_name: Some("Section".to_string()),
            }
        );
    }

    #[test]
    fn test_obsidian_link_with_header_and_alias() {
        let result = parse_tokens("[[Note#Section|Alias]]");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::ObsidianLink {
                source: "[[Note#Section|Alias]]".to_string(),
                page_target: "Note".to_string(),
                alias: Some("Alias".to_string()),
                header_name: Some("Section".to_string()),
            }
        );
    }

    #[test]
    fn test_obsidian_link_with_folder() {
        let result = parse_tokens("[[folder/Note]]");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::ObsidianLink {
                source: "[[folder/Note]]".to_string(),
                page_target: "Note".to_string(),
                alias: None,
                header_name: None,
            }
        );
    }

    #[test]
    fn test_obsidian_link_deep_folder() {
        // split("/")[1] returns index 1, NOT last segment
        let result = parse_tokens("[[a/b/Note]]");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::ObsidianLink {
                source: "[[a/b/Note]]".to_string(),
                page_target: "b".to_string(),
                alias: None,
                header_name: None,
            }
        );
    }

    #[test]
    fn test_obsidian_link_text_around() {
        let result = parse_tokens("before [[Link]] after");
        assert_eq!(result.len(), 3);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "before ".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::ObsidianLink {
                source: "[[Link]]".to_string(),
                page_target: "Link".to_string(),
                alias: None,
                header_name: None,
            }
        );
        assert_eq!(
            result[2],
            ParsedToken::Text {
                text: " after".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_multiple_obsidian_links() {
        let result = parse_tokens("[[A]] and [[B]]");
        assert_eq!(result.len(), 3);
        match &result[0] {
            ParsedToken::ObsidianLink { page_target, .. } => assert_eq!(page_target, "A"),
            _ => panic!("expected ObsidianLink"),
        }
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: " and ".to_string(),
                decoration: "none".to_string(),
            }
        );
        match &result[2] {
            ParsedToken::ObsidianLink { page_target, .. } => assert_eq!(page_target, "B"),
            _ => panic!("expected ObsidianLink"),
        }
    }

    #[test]
    fn test_unclosed_obsidian_link() {
        let result = parse_tokens("[[Unclosed");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "[[Unclosed".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_empty_obsidian_link() {
        let result = parse_tokens("[[]]");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::ObsidianLink {
                source: "[[]]".to_string(),
                page_target: "".to_string(),
                alias: None,
                header_name: None,
            }
        );
    }

    // ── Markdown link and image parsing (6 tests) ───────────────────────────

    #[test]
    fn test_markdown_link() {
        let result = parse_tokens("[text](http://example.com)");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Link {
                href: "http://example.com".to_string(),
                content: Some("text".to_string()),
            }
        );
    }

    #[test]
    fn test_markdown_link_empty_text() {
        let result = parse_tokens("[](http://x.com)");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Link {
                href: "http://x.com".to_string(),
                content: Some("".to_string()),
            }
        );
    }

    #[test]
    fn test_image() {
        let result = parse_tokens("![alt text](image.png)");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Image {
                src: "image.png".to_string(),
                alt: "alt text".to_string(),
            }
        );
    }

    #[test]
    fn test_image_no_alt() {
        let result = parse_tokens("![](image.png)");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Image {
                src: "image.png".to_string(),
                alt: "".to_string(),
            }
        );
    }

    #[test]
    fn test_obsidian_embed_not_image() {
        let result = parse_tokens("![[File]]");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "!".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::ObsidianLink {
                source: "[[File]]".to_string(),
                page_target: "File".to_string(),
                alias: None,
                header_name: None,
            }
        );
    }

    #[test]
    fn test_link_with_special_chars() {
        let result = parse_tokens("[docs](https://example.com/path?q=1&r=2)");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Link {
                href: "https://example.com/path?q=1&r=2".to_string(),
                content: Some("docs".to_string()),
            }
        );
    }

    // ── HTTP URL detection (5 tests) ────────────────────────────────────────

    #[test]
    fn test_bare_https_url() {
        let result = parse_tokens("https://example.com");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Link {
                href: "https://example.com".to_string(),
                content: Some("https://example.com".to_string()),
            }
        );
    }

    #[test]
    fn test_bare_http_url() {
        let result = parse_tokens("http://example.com");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Link {
                href: "http://example.com".to_string(),
                content: Some("http://example.com".to_string()),
            }
        );
    }

    #[test]
    fn test_url_after_text() {
        let result = parse_tokens("see https://x.com");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "see ".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Link {
                href: "https://x.com".to_string(),
                content: Some("https://x.com".to_string()),
            }
        );
    }

    #[test]
    fn test_url_not_in_brackets() {
        // URL inside markdown link syntax is consumed by the link parser, not double-detected
        let result = parse_tokens("[https://x.com](https://x.com)");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Link {
                href: "https://x.com".to_string(),
                content: Some("https://x.com".to_string()),
            }
        );
    }

    #[test]
    fn test_url_terminated_at_special_chars() {
        let result = parse_tokens("https://x.com/path) more");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Link {
                href: "https://x.com/path".to_string(),
                content: Some("https://x.com/path".to_string()),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: ") more".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    // ── Text decoration — two-token pattern (10 tests) ──────────────────────

    #[test]
    fn test_bold_two_tokens() {
        // markdown-it always produces text tokens around strong_open/strong_close
        // So "**bold text**" → text(""), bold(""), text("bold text"), text("")
        let result = parse_tokens("**bold text**");
        assert_eq!(result.len(), 4);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "bold".to_string(),
            }
        );
        assert_eq!(
            result[2],
            ParsedToken::Text {
                text: "bold text".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[3],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_italic_star_two_tokens() {
        let result = parse_tokens("*italic*");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "italic".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: "italic".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_italic_underscore_two_tokens() {
        let result = parse_tokens("_italic_");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "italic".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: "italic".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_strikethrough_two_tokens() {
        let result = parse_tokens("~~struck~~");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "strikethrough".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: "struck".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_inline_code_single_token() {
        let result = parse_tokens("`code here`");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "code here".to_string(),
                decoration: "code".to_string(),
            }
        );
    }

    #[test]
    fn test_bold_with_surrounding_text() {
        let result = parse_tokens("plain **bold** plain");
        assert_eq!(result.len(), 4);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "plain ".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "bold".to_string(),
            }
        );
        assert_eq!(
            result[2],
            ParsedToken::Text {
                text: "bold".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[3],
            ParsedToken::Text {
                text: " plain".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_unclosed_bold() {
        let result = parse_tokens("**unclosed");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "**unclosed".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_code_preserves_special() {
        let result = parse_tokens("`[[not a link]]`");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "[[not a link]]".to_string(),
                decoration: "code".to_string(),
            }
        );
    }

    #[test]
    fn test_italic_with_link_inside() {
        // *see [[Note]]* — emphasis wraps content with a link
        let result = parse_tokens("*see [[Note]]*");
        // Should produce: text("", italic), text("see "), ObsidianLink(Note)
        assert_eq!(result.len(), 3);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "italic".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: "see ".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[2],
            ParsedToken::ObsidianLink {
                source: "[[Note]]".to_string(),
                page_target: "Note".to_string(),
                alias: None,
                header_name: None,
            }
        );
    }

    #[test]
    fn test_bold_empty_content() {
        // **** — markdown-it treats this as plain text (empty content is not valid emphasis)
        let result = parse_tokens("****");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "****".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    // ── Meta-action extraction (6 tests) ────────────────────────────────────

    #[test]
    fn test_meta_action_triple() {
        let result = parse_tokens("text (meta-action-name::Open)(meta-action-url::https://x.com)");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "text".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::MetaAction {
                name: "Open".to_string(),
                url: "https://x.com".to_string(),
                icon: None,
            }
        );
    }

    #[test]
    fn test_meta_action_with_icon() {
        let result = parse_tokens("link (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "link".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::MetaAction {
                name: "Open".to_string(),
                url: "https://x.com".to_string(),
                icon: Some("globe-01-16".to_string()),
            }
        );
    }

    #[test]
    fn test_multiple_meta_actions() {
        let result = parse_tokens("text (meta-action-name::A)(meta-action-url::U1)(meta-action-name::B)(meta-action-url::U2)");
        let meta_count = result.iter().filter(|t| matches!(t, ParsedToken::MetaAction { .. })).count();
        assert_eq!(meta_count, 2);
    }

    #[test]
    fn test_meta_action_only() {
        let result = parse_tokens("(meta-action-name::X)(meta-action-url::Y)");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::MetaAction {
                name: "X".to_string(),
                url: "Y".to_string(),
                icon: None,
            }
        );
    }

    #[test]
    fn test_meta_action_removed_from_inline() {
        let result = parse_tokens("[[Note]] (meta-action-name::Open)(meta-action-url::U)");
        // The meta-action is extracted and the remaining text "[[Note]] " is parsed
        // which produces ObsidianLink, then MetaAction at the end
        let link_count = result.iter().filter(|t| matches!(t, ParsedToken::ObsidianLink { .. })).count();
        let meta_count = result.iter().filter(|t| matches!(t, ParsedToken::MetaAction { .. })).count();
        assert_eq!(link_count, 1);
        assert_eq!(meta_count, 1);
        // Meta-action appears after inline tokens
        assert!(matches!(result.last(), Some(ParsedToken::MetaAction { .. })));
    }

    #[test]
    fn test_meta_action_name_with_spaces() {
        let result = parse_tokens("(meta-action-name::Open Task)(meta-action-url::U)");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::MetaAction {
                name: "Open Task".to_string(),
                url: "U".to_string(),
                icon: None,
            }
        );
    }

    // ── Meta-mdtree extraction (3 tests) ────────────────────────────────────

    #[test]
    fn test_meta_mdtree() {
        let result = parse_tokens("text (meta-mdtree:: archive)");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "text".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::MetaMdtree {
                directive: "archive".to_string(),
            }
        );
    }

    #[test]
    fn test_meta_mdtree_no_space() {
        let result = parse_tokens("text (meta-mdtree::collapse)");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[1],
            ParsedToken::MetaMdtree {
                directive: "collapse".to_string(),
            }
        );
    }

    #[test]
    fn test_multiple_meta_mdtree() {
        let result = parse_tokens("text (meta-mdtree::archive)(meta-mdtree::collapse)");
        let mdtree_count = result.iter().filter(|t| matches!(t, ParsedToken::MetaMdtree { .. })).count();
        assert_eq!(mdtree_count, 2);
    }

    // ── Edge cases (4+ tests) ───────────────────────────────────────────────

    #[test]
    fn test_empty_input() {
        let result = parse_tokens("");
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_plain_text_only() {
        let result = parse_tokens("hello world");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "hello world".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_trim_applied() {
        let result = parse_tokens("  [[Note]]  ");
        // After trim, "[[Note]]" is parsed — no whitespace text tokens around it
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::ObsidianLink {
                source: "[[Note]]".to_string(),
                page_target: "Note".to_string(),
                alias: None,
                header_name: None,
            }
        );
    }

    #[test]
    fn test_output_order() {
        // Mixed content with both meta-action and meta-mdtree
        let result = parse_tokens("[[Note]] (meta-action-name::A)(meta-action-url::U)(meta-mdtree::archive)");
        // Should be: inline tokens, then meta-action, then meta-mdtree
        let last = result.last().unwrap();
        assert!(matches!(last, ParsedToken::MetaMdtree { .. }));
        let second_last = &result[result.len() - 2];
        assert!(matches!(second_last, ParsedToken::MetaAction { .. }));
    }

    // ── Regression tests for accepted review findings ───────────────────────

    #[test]
    fn test_empty_meta_action_icon_becomes_absent() {
        // TS behavior: `icon || undefined` — empty string becomes undefined (field absent)
        let result = parse_tokens("text (meta-action-name::X)(meta-action-url::Y)(meta-action-icon::)");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[1],
            ParsedToken::MetaAction {
                name: "X".to_string(),
                url: "Y".to_string(),
                icon: None, // NOT Some("") — matches TS behavior
            }
        );
    }

    #[test]
    fn test_double_backtick_code_span() {
        // `` `code content` `` with double backticks
        let result = parse_tokens("``code content``");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "code content".to_string(),
                decoration: "code".to_string(),
            }
        );
    }

    #[test]
    fn test_double_backtick_with_single_backtick_inside() {
        // Double backticks allow single backtick inside: `` `foo` ``
        let result = parse_tokens("``foo ` bar``");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "foo ` bar".to_string(),
                decoration: "code".to_string(),
            }
        );
    }

    #[test]
    fn test_url_inside_underscore_emphasis_not_detected() {
        // TS behavior: _https://example.com_ → italic("") + text("https://example.com")
        // URL is NOT detected as a link because inlineHttpLinkPlugin requires (^|\s) before URL
        // in the original source, and `_` is not whitespace.
        let result = parse_tokens("_https://example.com_");
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "italic".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: "https://example.com".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_url_inside_star_emphasis_with_space_and_trailing_text() {
        // *see https://example.com for info* — URL IS detected (preceded by whitespace within content)
        // and emphasis still forms because the URL doesn't consume the closing *
        let result = parse_tokens("*see https://example.com for info*");
        // Should produce: italic(""), text("see "), Link(https://example.com), text(" for info")
        assert_eq!(result.len(), 4);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "".to_string(),
                decoration: "italic".to_string(),
            }
        );
        assert_eq!(
            result[1],
            ParsedToken::Text {
                text: "see ".to_string(),
                decoration: "none".to_string(),
            }
        );
        assert_eq!(
            result[2],
            ParsedToken::Link {
                href: "https://example.com".to_string(),
                content: Some("https://example.com".to_string()),
            }
        );
        assert_eq!(
            result[3],
            ParsedToken::Text {
                text: " for info".to_string(),
                decoration: "none".to_string(),
            }
        );
    }

    #[test]
    fn test_triple_backtick_code_span() {
        // Triple backticks for code: ```code here```
        let result = parse_tokens("```code here```");
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0],
            ParsedToken::Text {
                text: "code here".to_string(),
                decoration: "code".to_string(),
            }
        );
    }

    #[test]
    fn test_standalone_bold() {
        // "**bold**" alone — 4 tokens (padding pattern from markdown-it)
        let result = parse_tokens("**bold**");
        assert_eq!(result.len(), 4);
        assert_eq!(result[0], ParsedToken::Text { text: "".to_string(), decoration: "none".to_string() });
        assert_eq!(result[1], ParsedToken::Text { text: "".to_string(), decoration: "bold".to_string() });
        assert_eq!(result[2], ParsedToken::Text { text: "bold".to_string(), decoration: "none".to_string() });
        assert_eq!(result[3], ParsedToken::Text { text: "".to_string(), decoration: "none".to_string() });
    }
}
