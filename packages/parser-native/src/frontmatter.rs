use serde::Serialize;
use serde_json::Map;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterResult {
    pub frontmatter: serde_json::Value,
    pub body_start: usize,
}

/// Parse YAML frontmatter from a markdown string.
///
/// Detects `---` delimiters matching the behavior of the TypeScript regex:
/// `^---\r?\n([\s\S]*?)\r?\n---`
///
/// Returns the parsed frontmatter as a JSON object and the byte offset
/// where the markdown body begins (end of closing `---`).
pub fn parse_frontmatter(content: &str) -> FrontmatterResult {
    let empty = FrontmatterResult {
        frontmatter: serde_json::Value::Object(Map::new()),
        body_start: 0,
    };

    // Check if content starts with `---\n` or `---\r\n`
    let after_open = if content.starts_with("---\r\n") {
        5 // length of "---\r\n"
    } else if content.starts_with("---\n") {
        4 // length of "---\n"
    } else {
        return empty;
    };

    // Find the closing `---` delimiter.
    // The TS regex requires `\r?\n---` after the content, meaning we need
    // a newline character followed by `---`.
    // We search for `\n---` in the content after the opening delimiter.
    let rest = &content[after_open..];

    let close_pos = find_closing_delimiter(rest);

    match close_pos {
        None => empty,
        Some((yaml_end, delimiter_end)) => {
            // yaml_end is the position of the \r?\n before closing ---
            // delimiter_end is after the closing ---
            let yaml_str = &rest[..yaml_end];
            let body_start = after_open + delimiter_end;

            // Parse YAML
            let frontmatter = parse_yaml(yaml_str);

            FrontmatterResult {
                frontmatter,
                body_start,
            }
        }
    }
}

/// Find the closing `---` delimiter in the text after the opening marker.
/// Returns (yaml_content_end, delimiter_end) where:
/// - yaml_content_end: byte offset of the `\r?\n` before `---`
/// - delimiter_end: byte offset after the closing `---`
///
/// This matches the TS regex behavior: `([\s\S]*?)\r?\n---`
/// The regex is lazy, so it finds the FIRST occurrence of `\n---` (or `\r\n---`).
fn find_closing_delimiter(text: &str) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'\n' {
            // Check if followed by `---`
            if i + 4 <= len && &bytes[i + 1..i + 4] == b"---" {
                // Check that the `---` is at end of line or end of string
                // Actually the TS regex just needs \n---  at this point,
                // it doesn't care what follows. The match[0] ends at the closing `---`.
                // But we need to check for \r before \n
                let yaml_end = if i > 0 && bytes[i - 1] == b'\r' {
                    i - 1
                } else {
                    i
                };
                let delimiter_end = i + 4; // after \n---
                return Some((yaml_end, delimiter_end));
            }
        } else if bytes[i] == b'\r' && i + 1 < len && bytes[i + 1] == b'\n' {
            // \r\n case
            if i + 5 <= len && &bytes[i + 2..i + 5] == b"---" {
                let yaml_end = i; // the \r\n is the separator
                let delimiter_end = i + 5; // after \r\n---
                return Some((yaml_end, delimiter_end));
            }
        }
        i += 1;
    }

    None
}

/// Parse a YAML string into a serde_json::Value.
/// Returns an empty object if parsing fails or if the result is not a mapping.
fn parse_yaml(yaml_str: &str) -> serde_json::Value {
    // Handle empty YAML string
    if yaml_str.trim().is_empty() {
        return serde_json::Value::Object(Map::new());
    }

    // Parse YAML to serde_yaml::Value, then convert to serde_json::Value
    match serde_yaml::from_str::<serde_yaml::Value>(yaml_str) {
        Ok(yaml_val) => {
            // Convert to JSON value
            match serde_json::to_value(&yaml_val) {
                Ok(json_val) => {
                    if json_val.is_object() {
                        json_val
                    } else {
                        // Top-level must be an object
                        serde_json::Value::Object(Map::new())
                    }
                }
                Err(_) => serde_json::Value::Object(Map::new()),
            }
        }
        Err(_) => serde_json::Value::Object(Map::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_frontmatter() {
        let input = "---\ntitle: Hello\n---\nbody";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        assert_eq!(fm.get("title").unwrap(), "Hello");
        // "---\ntitle: Hello\n---" = 20 chars
        assert_eq!(result.body_start, 20);
    }

    #[test]
    fn array_values() {
        let input = "---\naliases:\n  - Alias1\n  - Alias2\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        let aliases = fm.get("aliases").unwrap().as_array().unwrap();
        assert_eq!(aliases.len(), 2);
        assert_eq!(aliases[0], "Alias1");
        assert_eq!(aliases[1], "Alias2");
    }

    #[test]
    fn nested_object() {
        let input = "---\nmetadata:\n  author: Jane\n  version: 2\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        let metadata = fm.get("metadata").unwrap().as_object().unwrap();
        assert_eq!(metadata.get("author").unwrap(), "Jane");
        assert_eq!(metadata.get("version").unwrap(), 2);
    }

    #[test]
    fn no_frontmatter() {
        let input = "# Just a header\n- item";
        let result = parse_frontmatter(input);
        assert_eq!(result.frontmatter, serde_json::Value::Object(Map::new()));
        assert_eq!(result.body_start, 0);
    }

    #[test]
    fn empty_frontmatter_block() {
        // The TS regex ^---\r?\n([\s\S]*?)\r?\n--- requires content between
        // the delimiters to have at least a \n before the closing ---.
        // So "---\n\n---" works: the YAML content is empty, \n before ---.
        let input = "---\n\n---\nbody";
        let result = parse_frontmatter(input);
        assert_eq!(result.frontmatter, serde_json::Value::Object(Map::new()));
        // "---\n\n---" = 8 chars
        assert_eq!(result.body_start, 8);
    }

    #[test]
    fn malformed_yaml() {
        let input = "---\n: invalid: yaml: [[[\n---\nbody";
        let result = parse_frontmatter(input);
        assert_eq!(result.frontmatter, serde_json::Value::Object(Map::new()));
        // Should still advance past the block
        // "---\n: invalid: yaml: [[[\n---" = 29 chars
        assert!(result.body_start > 0);
    }

    #[test]
    fn crlf_line_endings() {
        let input = "---\r\ntitle: Hello\r\n---\r\nbody";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        assert_eq!(fm.get("title").unwrap(), "Hello");
        // "---\r\ntitle: Hello\r\n---" = 22 chars (with \r\n opening and \r\n before close)
        // Opening: ---\r\n = 5 bytes
        // After open: "title: Hello\r\n---\r\nbody"
        // Find \r\n--- : at position 12 ("title: Hello" length), \r\n--- starts
        // yaml_end = 12 (at the \r), delimiter_end = 12 + 5 = 17
        // body_start = 5 + 17 = 22
        assert_eq!(result.body_start, 22);
    }

    #[test]
    fn boolean_and_number_values() {
        let input = "---\ndraft: true\ncount: 42\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        assert_eq!(fm.get("draft").unwrap(), true);
        assert_eq!(fm.get("count").unwrap(), 42);
    }

    #[test]
    fn null_values() {
        let input = "---\nempty:\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        assert!(fm.get("empty").unwrap().is_null());
    }

    #[test]
    fn non_object_top_level() {
        let input = "---\n- item1\n- item2\n---\n";
        let result = parse_frontmatter(input);
        assert_eq!(result.frontmatter, serde_json::Value::Object(Map::new()));
        assert!(result.body_start > 0);
    }

    #[test]
    fn string_with_obsidian_link() {
        let input = "---\nparent: \"[[Root]]\"\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        assert_eq!(fm.get("parent").unwrap(), "[[Root]]");
    }

    #[test]
    fn flow_style_array() {
        let input = "---\ntags: [work, personal]\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        let tags = fm.get("tags").unwrap().as_array().unwrap();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0], "work");
        assert_eq!(tags[1], "personal");
    }

    #[test]
    fn truncated_closing_delimiter_lf() {
        // Triggers the boundary guard: "---\n" opening followed by "\n--" (incomplete close)
        let input = "---\n\n--";
        let result = parse_frontmatter(input);
        // Should not panic; no valid closing delimiter found → returns empty
        assert_eq!(result.frontmatter, serde_json::Value::Object(Map::new()));
        assert_eq!(result.body_start, 0);
    }

    #[test]
    fn truncated_closing_delimiter_crlf() {
        // Triggers the CRLF boundary guard: "---\r\n" opening followed by "\r\n--"
        let input = "---\r\n\r\n--";
        let result = parse_frontmatter(input);
        // Should not panic; no valid closing delimiter found → returns empty
        assert_eq!(result.frontmatter, serde_json::Value::Object(Map::new()));
        assert_eq!(result.body_start, 0);
    }

    #[test]
    fn aliases_as_string() {
        let input = "---\naliases: SingleAlias\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        assert_eq!(fm.get("aliases").unwrap(), "SingleAlias");
    }

    #[test]
    fn multiline_value_clip() {
        // | (clip) — the final \n before --- is consumed by the delimiter detection,
        // so serde_yaml sees content without a trailing newline. Both parsers
        // (serde_yaml and js-yaml) produce "This is a\nmultiline value\n" because
        // YAML clip mode always adds a final line break.
        // However, when extracted from frontmatter, the trailing \n is part of the
        // delimiter boundary. The actual observed output depends on the YAML parser.
        let input = "---\ndescription: |\n  This is a\n  multiline value\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        let desc = fm.get("description").unwrap().as_str().unwrap();
        assert!(desc.contains("This is a"));
        assert!(desc.contains("multiline value"));
    }

    #[test]
    fn multiline_value_strip() {
        // |- (strip) does NOT retain trailing newline — matches js-yaml behavior
        let input = "---\ndescription: |-\n  This is a\n  multiline value\n---\n";
        let result = parse_frontmatter(input);
        let fm = result.frontmatter.as_object().unwrap();
        let desc = fm.get("description").unwrap().as_str().unwrap();
        assert_eq!(desc, "This is a\nmultiline value");
    }
}
