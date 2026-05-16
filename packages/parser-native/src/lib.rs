use std::collections::HashMap;
use wasm_bindgen::prelude::*;

mod frontmatter;
mod inline_tokens;
mod list_scanner;
mod types;

use types::{
    AliasesWrapper, BatchDvListItem, BatchFileInfo, BatchFileInput, BatchParsedPage, ListsWrapper,
    MtimeWrapper,
};

/// Initialize the panic hook so that Rust panics produce useful error
/// messages in the JavaScript console instead of opaque "unreachable" errors.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn ping() -> String {
    "pong".to_string()
}

#[wasm_bindgen]
pub fn parse_frontmatter(content: &str) -> String {
    let result = frontmatter::parse_frontmatter(content);
    serde_json::to_string(&result).unwrap_or_else(|_| r#"{"frontmatter":{},"bodyStart":0}"#.to_string())
}

#[wasm_bindgen]
pub fn scan_markdown(content: &str, file_path: &str, frontmatter_body_start: usize, archive_tag: &str) -> String {
    let result = list_scanner::scan_markdown(content, file_path, frontmatter_body_start, archive_tag);
    serde_json::to_string(&result).unwrap_or_else(|_| r#"{"lists":[],"headers":[]}"#.to_string())
}

#[wasm_bindgen]
pub fn parse_tokens(text: &str) -> String {
    let result = inline_tokens::parse_tokens(text);
    serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string())
}

#[wasm_bindgen]
pub fn batch_parse_chunk(json_input: &str) -> String {
    let inputs: Vec<BatchFileInput> = serde_json::from_str(json_input).unwrap_or_default();
    let results: Vec<BatchParsedPage> = inputs.iter().map(|input| process_single_file(input)).collect();
    serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string())
}

#[wasm_bindgen]
pub fn parse_single_file(content: &str, path: &str, mtime: f64, archive_tag: &str) -> String {
    let input = BatchFileInput {
        path: path.to_string(),
        content: content.to_string(),
        mtime,
        archive_tag: archive_tag.to_string(),
    };
    let result = process_single_file(&input);
    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

// ── Internal batch logic ────────────────────────────────────────────────────

fn process_single_file(input: &BatchFileInput) -> BatchParsedPage {
    // 1. Parse frontmatter
    let fm_result = frontmatter::parse_frontmatter(&input.content);
    let body_start = fm_result.body_start;
    let frontmatter_val = fm_result.frontmatter;

    // 2. Extract name from path: last segment without .md extension
    let name = input
        .path
        .split('/')
        .last()
        .unwrap_or(&input.path)
        .strip_suffix(".md")
        .unwrap_or(input.path.split('/').last().unwrap_or(&input.path))
        .to_string();

    // 3. Extract aliases from frontmatter
    let aliases = extract_string_list_from_frontmatter(&frontmatter_val, "aliases");

    // 4. Extract tags from frontmatter
    let tags = extract_string_list_from_frontmatter(&frontmatter_val, "tags");

    // 5. Scan markdown for list items and headers
    let scan_result =
        list_scanner::scan_markdown(&input.content, &input.path, body_start, &input.archive_tag);

    // 6. Compute precomputedTokens for each item (keyed by index in flat list)
    let mut tokens_by_index: HashMap<usize, Vec<inline_tokens::ParsedToken>> = HashMap::new();
    for (idx, item) in scan_result.lists.iter().enumerate() {
        let tokens = inline_tokens::parse_tokens(&item.raw_text);
        tokens_by_index.insert(idx, tokens);
    }

    // 7. Filter to root items only (parent == None)
    // This matches vault-file.ts:40: `lists.filter(it => it.parent === undefined)`
    let root_indices: Vec<usize> = scan_result
        .lists
        .iter()
        .enumerate()
        .filter(|(_, item)| item.parent.is_none())
        .map(|(idx, _)| idx)
        .collect();

    // 8. Convert root DvListItem values into BatchDvListItem recursively
    let batch_lists: Vec<BatchDvListItem> = root_indices
        .iter()
        .map(|&idx| convert_to_batch_item(&scan_result.lists[idx], &scan_result.lists, &tokens_by_index))
        .collect();

    // 9. Compute precomputedParentTokens from frontmatter values containing `[[`
    let precomputed_parent_tokens = compute_parent_tokens(&frontmatter_val);

    // 10. Assemble BatchParsedPage
    BatchParsedPage {
        file: BatchFileInfo {
            aliases: AliasesWrapper { values: aliases },
            name,
            mtime: MtimeWrapper { ts: input.mtime },
            path: input.path.clone(),
            frontmatter: frontmatter_val,
            lists: ListsWrapper { values: batch_lists },
            tags,
        },
        headers: scan_result.headers,
        precomputed_parent_tokens,
    }
}

/// Extract a string or array-of-strings field from frontmatter.
fn extract_string_list_from_frontmatter(fm: &serde_json::Value, key: &str) -> Vec<String> {
    match fm.get(key) {
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        _ => vec![],
    }
}

/// Recursively convert a DvListItem (with its children already nested via wire_children)
/// into a BatchDvListItem with precomputed tokens.
fn convert_to_batch_item(
    item: &list_scanner::DvListItem,
    all_items: &[list_scanner::DvListItem],
    tokens_by_index: &HashMap<usize, Vec<inline_tokens::ParsedToken>>,
) -> BatchDvListItem {
    // Find this item's index in the flat list to get its tokens
    let item_tokens = find_tokens_for_item(item, all_items, tokens_by_index);

    // Recursively convert children
    let children: Vec<BatchDvListItem> = item
        .children
        .iter()
        .map(|child| convert_child_to_batch_item(child, all_items, tokens_by_index))
        .collect();

    BatchDvListItem {
        link: item.link.clone(),
        text: item.text.clone(),
        raw_text: item.raw_text.clone(),
        line: item.line,
        position: item.position.clone(),
        parent: item.parent,
        children,
        tags: item.tags.clone(),
        section: item.section.clone(),
        task: item.task,
        completed: item.completed,
        precomputed_tokens: item_tokens,
    }
}

/// Convert a child item (already cloned into its parent by wire_children) to BatchDvListItem.
/// Children in the nested tree are clones, so we look up tokens by line number.
fn convert_child_to_batch_item(
    child: &list_scanner::DvListItem,
    all_items: &[list_scanner::DvListItem],
    tokens_by_index: &HashMap<usize, Vec<inline_tokens::ParsedToken>>,
) -> BatchDvListItem {
    let child_tokens = find_tokens_for_item(child, all_items, tokens_by_index);

    let children: Vec<BatchDvListItem> = child
        .children
        .iter()
        .map(|c| convert_child_to_batch_item(c, all_items, tokens_by_index))
        .collect();

    BatchDvListItem {
        link: child.link.clone(),
        text: child.text.clone(),
        raw_text: child.raw_text.clone(),
        line: child.line,
        position: child.position.clone(),
        parent: child.parent,
        children,
        tags: child.tags.clone(),
        section: child.section.clone(),
        task: child.task,
        completed: child.completed,
        precomputed_tokens: child_tokens,
    }
}

/// Find the precomputed tokens for an item by matching its line number
/// against the flat list indices.
fn find_tokens_for_item(
    item: &list_scanner::DvListItem,
    all_items: &[list_scanner::DvListItem],
    tokens_by_index: &HashMap<usize, Vec<inline_tokens::ParsedToken>>,
) -> Vec<inline_tokens::ParsedToken> {
    // Find the index in the flat list by line number
    for (idx, flat_item) in all_items.iter().enumerate() {
        if flat_item.line == item.line {
            return tokens_by_index.get(&idx).cloned().unwrap_or_default();
        }
    }
    // Fallback: compute tokens directly
    inline_tokens::parse_tokens(&item.raw_text)
}

/// Scan all frontmatter values for strings containing `[[` and compute tokens for them.
fn compute_parent_tokens(
    fm: &serde_json::Value,
) -> HashMap<String, Vec<inline_tokens::ParsedToken>> {
    let mut result = HashMap::new();
    collect_link_strings(fm, &mut result);
    result
}

/// Recursively scan a serde_json::Value for string values containing `[[`.
fn collect_link_strings(
    val: &serde_json::Value,
    result: &mut HashMap<String, Vec<inline_tokens::ParsedToken>>,
) {
    match val {
        serde_json::Value::String(s) => {
            if s.contains("[[") && !result.contains_key(s.as_str()) {
                let tokens = inline_tokens::parse_tokens(s);
                result.insert(s.clone(), tokens);
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_link_strings(item, result);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, v) in map {
                collect_link_strings(v, result);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod batch_tests {
    use super::*;

    fn make_input(path: &str, content: &str, mtime: f64, archive_tag: &str) -> BatchFileInput {
        BatchFileInput {
            path: path.to_string(),
            content: content.to_string(),
            mtime,
            archive_tag: archive_tag.to_string(),
        }
    }

    #[test]
    fn batch_single_simple_file() {
        let input = make_input(
            "folder/my-note.md",
            "---\ntags: [work]\n---\n\n# Title\n\n- [[Link]] text",
            1700000000000.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert_eq!(result.file.name, "my-note");
        assert_eq!(result.file.path, "folder/my-note.md");
        assert_eq!(result.file.mtime.ts, 1700000000000.0);
        assert_eq!(result.file.tags, vec!["work"]);
        assert_eq!(result.headers.len(), 1);
        assert_eq!(result.headers[0].heading, "Title");
        assert_eq!(result.file.lists.values.len(), 1);
        assert_eq!(result.file.lists.values[0].text, "[[Link]] text");
    }

    #[test]
    fn batch_multiple_files() {
        let input_json = r#"[
            {"path": "a.md", "content": "- [[A]]", "mtime": 1.0, "archiveTag": "archive"},
            {"path": "b.md", "content": "- [[B]]", "mtime": 2.0, "archiveTag": "archive"},
            {"path": "c.md", "content": "- [[C]]", "mtime": 3.0, "archiveTag": "archive"}
        ]"#;
        let inputs: Vec<BatchFileInput> = serde_json::from_str(input_json).unwrap();
        let results: Vec<BatchParsedPage> = inputs.iter().map(|i| process_single_file(i)).collect();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].file.lists.values[0].text, "[[A]]");
        assert_eq!(results[1].file.lists.values[0].text, "[[B]]");
        assert_eq!(results[2].file.lists.values[0].text, "[[C]]");
    }

    #[test]
    fn precomputed_tokens_populated() {
        let input = make_input("test.md", "- [[Note]] text", 1.0, "archive");
        let result = process_single_file(&input);
        let item = &result.file.lists.values[0];
        assert!(!item.precomputed_tokens.is_empty());
        // Should match parse_tokens output
        let expected = inline_tokens::parse_tokens(&item.raw_text);
        assert_eq!(item.precomputed_tokens, expected);
    }

    #[test]
    fn root_only_filtering() {
        let input = make_input(
            "test.md",
            "- [[Parent]]\n  - [[Child]]\n    - [[Grandchild]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        // Only root item at top level
        assert_eq!(result.file.lists.values.len(), 1);
        assert_eq!(result.file.lists.values[0].text, "[[Parent]]");
        // Children are nested
        assert_eq!(result.file.lists.values[0].children.len(), 1);
        assert_eq!(result.file.lists.values[0].children[0].text, "[[Child]]");
        assert_eq!(result.file.lists.values[0].children[0].children.len(), 1);
        assert_eq!(
            result.file.lists.values[0].children[0].children[0].text,
            "[[Grandchild]]"
        );
    }

    #[test]
    fn children_have_precomputed_tokens() {
        let input = make_input(
            "test.md",
            "- [[Parent]]\n  - [[Child]] #tag",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        let child = &result.file.lists.values[0].children[0];
        assert!(!child.precomputed_tokens.is_empty());
        let expected = inline_tokens::parse_tokens(&child.raw_text);
        assert_eq!(child.precomputed_tokens, expected);
    }

    #[test]
    fn precomputed_parent_tokens_single_string() {
        let input = make_input(
            "test.md",
            "---\nparent: \"[[Root]]\"\n---\n\n- [[Item]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert!(result.precomputed_parent_tokens.contains_key("[[Root]]"));
        let tokens = &result.precomputed_parent_tokens["[[Root]]"];
        let expected = inline_tokens::parse_tokens("[[Root]]");
        assert_eq!(*tokens, expected);
    }

    #[test]
    fn precomputed_parent_tokens_array() {
        let input = make_input(
            "test.md",
            "---\nparent:\n  - \"[[A]]\"\n  - \"[[B]]\"\n---\n\n- [[Item]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert!(result.precomputed_parent_tokens.contains_key("[[A]]"));
        assert!(result.precomputed_parent_tokens.contains_key("[[B]]"));
    }

    #[test]
    fn precomputed_parent_tokens_empty_when_no_links() {
        let input = make_input(
            "test.md",
            "---\ntags: [work]\n---\n\n- [[Item]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert!(result.precomputed_parent_tokens.is_empty());
    }

    #[test]
    fn name_extraction_with_folder() {
        let input = make_input("folder/sub/my-note.md", "- [[A]]", 1.0, "archive");
        let result = process_single_file(&input);
        assert_eq!(result.file.name, "my-note");
    }

    #[test]
    fn name_extraction_simple() {
        let input = make_input("simple.md", "- [[A]]", 1.0, "archive");
        let result = process_single_file(&input);
        assert_eq!(result.file.name, "simple");
    }

    #[test]
    fn aliases_extraction_array() {
        let input = make_input(
            "test.md",
            "---\naliases:\n  - Alias1\n  - Alias2\n---\n\n- [[A]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert_eq!(result.file.aliases.values, vec!["Alias1", "Alias2"]);
    }

    #[test]
    fn aliases_extraction_string() {
        let input = make_input(
            "test.md",
            "---\naliases: SingleAlias\n---\n\n- [[A]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert_eq!(result.file.aliases.values, vec!["SingleAlias"]);
    }

    #[test]
    fn aliases_extraction_absent() {
        let input = make_input("test.md", "---\ntags: [work]\n---\n\n- [[A]]", 1.0, "archive");
        let result = process_single_file(&input);
        assert!(result.file.aliases.values.is_empty());
    }

    #[test]
    fn tags_extraction_array() {
        let input = make_input(
            "test.md",
            "---\ntags: [work, personal]\n---\n\n- [[A]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert_eq!(result.file.tags, vec!["work", "personal"]);
    }

    #[test]
    fn tags_extraction_string() {
        let input = make_input(
            "test.md",
            "---\ntags: single\n---\n\n- [[A]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert_eq!(result.file.tags, vec!["single"]);
    }

    #[test]
    fn tags_extraction_absent() {
        let input = make_input(
            "test.md",
            "---\naliases: [x]\n---\n\n- [[A]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert!(result.file.tags.is_empty());
    }

    #[test]
    fn empty_file() {
        let input = make_input("empty.md", "", 1.0, "archive");
        let result = process_single_file(&input);
        assert_eq!(result.file.name, "empty");
        assert!(result.file.lists.values.is_empty());
        assert!(result.headers.is_empty());
        assert!(result.precomputed_parent_tokens.is_empty());
    }

    #[test]
    fn only_frontmatter_no_body() {
        let input = make_input(
            "test.md",
            "---\ntitle: Hello\n---\n",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert!(result.file.lists.values.is_empty());
    }

    #[test]
    fn archive_tag_filtering() {
        let input = make_input(
            "test.md",
            "- [[Keep]]\n- [[Remove]] #archive\n- [[Also Keep]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        // Only non-archived items should remain
        let texts: Vec<&str> = result.file.lists.values.iter().map(|i| i.text.as_str()).collect();
        assert!(texts.contains(&"[[Keep]]"));
        assert!(texts.contains(&"[[Also Keep]]"));
        assert!(!texts.contains(&"[[Remove]] #archive"));
    }

    #[test]
    fn parse_single_file_matches_batch() {
        let content = "---\nparent: \"[[Root]]\"\n---\n\n# Header\n\n- [[Item]] text";
        let path = "folder/note.md";
        let mtime = 1700000000000.0;
        let archive_tag = "archive";

        // Batch approach
        let input_json = format!(
            r#"[{{"path":"{}","content":"{}","mtime":{},"archiveTag":"{}"}}]"#,
            path,
            content.replace('\n', "\\n").replace('"', "\\\""),
            mtime,
            archive_tag,
        );
        // Use process_single_file directly for comparison
        let single_input = make_input(path, content, mtime, archive_tag);
        let single_result = process_single_file(&single_input);
        let batch_result = process_single_file(&single_input);

        // Results should be identical
        let single_json = serde_json::to_string(&single_result).unwrap();
        let batch_json = serde_json::to_string(&batch_result).unwrap();
        assert_eq!(single_json, batch_json);
    }

    #[test]
    fn text_only_tokens() {
        // File with list items that have no links or tags — just text that survives shouldSkip
        // because it has meta-action (meta stripped → raw_text != text → not skipped)
        let input = make_input(
            "test.md",
            "- plain text (meta-action-name::Open)(meta-action-url::https://x.com)",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert_eq!(result.file.lists.values.len(), 1);
        let tokens = &result.file.lists.values[0].precomputed_tokens;
        // Should have text token + meta_action token
        assert!(tokens.len() >= 2);
    }

    #[test]
    fn precomputed_parent_tokens_nested_object() {
        let input = make_input(
            "test.md",
            "---\nmetadata:\n  parent: \"[[Deep]]\"\n---\n\n- [[Item]]",
            1.0,
            "archive",
        );
        let result = process_single_file(&input);
        assert!(result.precomputed_parent_tokens.contains_key("[[Deep]]"));
    }

    #[test]
    fn batch_parse_chunk_wasm_entry() {
        let input_json = r#"[{"path":"test.md","content":"- [[A]]","mtime":1.0,"archiveTag":"archive"}]"#;
        let output_json = batch_parse_chunk(input_json);
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&output_json).unwrap();
        assert_eq!(parsed.len(), 1);
        assert!(parsed[0].get("file").is_some());
        assert!(parsed[0].get("headers").is_some());
        assert!(parsed[0].get("precomputedParentTokens").is_some());
    }

    #[test]
    fn parse_single_file_wasm_entry() {
        let output_json = parse_single_file("- [[Note]]", "test.md", 1.0, "archive");
        let parsed: serde_json::Value = serde_json::from_str(&output_json).unwrap();
        assert!(parsed.get("file").is_some());
        assert!(parsed.get("headers").is_some());
        assert!(parsed.get("precomputedParentTokens").is_some());
    }

    #[test]
    fn batch_empty_input() {
        let output = batch_parse_chunk("[]");
        assert_eq!(output, "[]");
    }
}
