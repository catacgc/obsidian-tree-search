use serde::Serialize;

// ── Output structures (serializable to JSON) ─────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub lists: Vec<DvListItem>,
    pub headers: Vec<HeadingCacheItem>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DvListItem {
    pub link: LinkRef,
    pub text: String,
    pub raw_text: String,
    pub line: usize,
    pub position: ListPosition,
    pub parent: Option<usize>,
    pub children: Vec<DvListItem>,
    pub tags: Vec<String>,
    pub section: Section,
    pub task: bool,
    pub completed: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct LinkRef {
    pub path: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ListPosition {
    pub start: ListPos,
    pub end: ListPos,
}

#[derive(Serialize, Clone, Debug)]
pub struct ListPos {
    pub line: usize,
    pub col: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct Section {
    pub subpath: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct HeadingCacheItem {
    pub heading: String,
    pub level: usize,
    pub position: HeadingPosition,
}

#[derive(Serialize, Clone, Debug)]
pub struct HeadingPosition {
    pub start: HeadingPos,
    pub end: HeadingPos,
}

#[derive(Serialize, Clone, Debug)]
pub struct HeadingPos {
    pub line: usize,
    pub ch: usize,
}

// ── Regex patterns (matching TypeScript) ─────────────────────────────────────

fn is_list_item(line: &str) -> Option<(usize, &str)> {
    // Match: ^(\s*)(?:[-*+]|\d+\.)\s+(.*)
    let bytes = line.as_bytes();
    let len = bytes.len();

    // Count leading whitespace
    let mut indent = 0;
    while indent < len && (bytes[indent] == b' ' || bytes[indent] == b'\t') {
        indent += 1;
    }

    if indent >= len {
        return None;
    }

    // Check bullet type
    let after_bullet;
    if bytes[indent] == b'-' || bytes[indent] == b'*' || bytes[indent] == b'+' {
        after_bullet = indent + 1;
    } else if bytes[indent].is_ascii_digit() {
        // numbered list: \d+\.
        let mut i = indent;
        while i < len && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i >= len || bytes[i] != b'.' {
            return None;
        }
        after_bullet = i + 1;
    } else {
        return None;
    }

    // Must have \s+ after bullet
    if after_bullet >= len || (bytes[after_bullet] != b' ' && bytes[after_bullet] != b'\t') {
        return None;
    }

    // Skip whitespace after bullet
    let mut text_start = after_bullet;
    while text_start < len && (bytes[text_start] == b' ' || bytes[text_start] == b'\t') {
        text_start += 1;
    }

    let text = &line[text_start..];
    Some((indent, text))
}

fn is_header(line: &str) -> Option<(usize, &str)> {
    // Match: ^(#{1,6})\s+(.*)
    let bytes = line.as_bytes();
    let len = bytes.len();

    if len == 0 || bytes[0] != b'#' {
        return None;
    }

    let mut level = 0;
    while level < len && level < 6 && bytes[level] == b'#' {
        level += 1;
    }

    if level == 0 || level >= len {
        return None;
    }

    // Must have \s+ after hashes
    if bytes[level] != b' ' && bytes[level] != b'\t' {
        return None;
    }

    // Skip whitespace
    let mut text_start = level;
    while text_start < len && (bytes[text_start] == b' ' || bytes[text_start] == b'\t') {
        text_start += 1;
    }

    let text = &line[text_start..];
    Some((level, text))
}

fn is_task(text: &str) -> Option<(bool, &str)> {
    // Match: ^\[([ xX])\]\s+(.*)
    let bytes = text.as_bytes();
    if bytes.len() < 4 {
        return None;
    }
    if bytes[0] != b'[' {
        return None;
    }
    let marker = bytes[1];
    if marker != b' ' && marker != b'x' && marker != b'X' {
        return None;
    }
    if bytes[2] != b']' {
        return None;
    }
    // Need \s+ after ]
    if bytes.len() < 5 || (bytes[3] != b' ' && bytes[3] != b'\t') {
        return None;
    }
    // Skip whitespace after ]
    let mut start = 3;
    while start < bytes.len() && (bytes[start] == b' ' || bytes[start] == b'\t') {
        start += 1;
    }
    let completed = marker == b'x' || marker == b'X';
    Some((completed, &text[start..]))
}

fn extract_inline_tags(text: &str) -> Vec<String> {
    // Match: #([\w/]+) globally
    let mut tags = Vec::new();
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'#' {
            let start = i + 1;
            let mut end = start;
            while end < len && is_tag_char(bytes[end]) {
                end += 1;
            }
            if end > start {
                let tag_body = &text[start..end];
                tags.push(format!("#{}", tag_body));
                i = end;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    tags
}

#[inline]
fn is_tag_char(b: u8) -> bool {
    // [\w/] — word char (alphanumeric + underscore) or forward slash
    b.is_ascii_alphanumeric() || b == b'_' || b == b'/'
}

fn strip_meta_action(text: &str) -> String {
    // Remove: \(meta-action-[\w-]+::[^)]*\) globally
    let mut result = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'(' && text[i..].starts_with("(meta-action-") {
            // Try to find the closing )
            if let Some(close) = find_meta_action_end(&text[i..]) {
                i += close + 1; // skip past the closing )
                continue;
            }
        }
        result.push(text[i..].chars().next().unwrap());
        i += text[i..].chars().next().unwrap().len_utf8();
    }

    result
}

fn find_meta_action_end(s: &str) -> Option<usize> {
    // s starts with "(meta-action-"
    // Pattern: (meta-action-[\w-]+::[^)]*\)
    let bytes = s.as_bytes();
    let prefix = "(meta-action-";
    if !s.starts_with(prefix) {
        return None;
    }
    let mut i = prefix.len();
    let len = bytes.len();

    // [\w-]+
    let start_ident = i;
    while i < len && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'-') {
        i += 1;
    }
    if i == start_ident {
        return None; // need at least one char
    }

    // ::
    if i + 1 >= len || bytes[i] != b':' || bytes[i + 1] != b':' {
        return None;
    }
    i += 2;

    // [^)]*
    while i < len && bytes[i] != b')' {
        i += 1;
    }

    // \)
    if i >= len || bytes[i] != b')' {
        return None;
    }

    Some(i)
}

fn strip_meta_mdtree(text: &str) -> String {
    // Remove: \(meta-mdtree::\s*\w+\) globally
    let mut result = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if bytes[i] == b'(' && text[i..].starts_with("(meta-mdtree::") {
            if let Some(close) = find_meta_mdtree_end(&text[i..]) {
                i += close + 1;
                continue;
            }
        }
        result.push(text[i..].chars().next().unwrap());
        i += text[i..].chars().next().unwrap().len_utf8();
    }

    result
}

fn find_meta_mdtree_end(s: &str) -> Option<usize> {
    // s starts with "(meta-mdtree::"
    // Pattern: (meta-mdtree::\s*\w+\)
    let bytes = s.as_bytes();
    let prefix = "(meta-mdtree::";
    if !s.starts_with(prefix) {
        return None;
    }
    let mut i = prefix.len();
    let len = bytes.len();

    // \s*
    while i < len && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }

    // \w+
    let start_word = i;
    while i < len && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i == start_word {
        return None; // need at least one word char
    }

    // \)
    if i >= len || bytes[i] != b')' {
        return None;
    }

    Some(i)
}

fn should_skip(text: &str, archive_tag: &str) -> bool {
    if text.contains(archive_tag) {
        return true;
    }
    // skip pure prose: no links, tags, tasks, or URLs
    !text.contains("[[")
        && !text.contains("![[")
        && !text.contains('#')
        && !text.contains("http")
        && !text.contains("- [")
}

// ── Main scan function ───────────────────────────────────────────────────────

pub fn scan_markdown(
    content: &str,
    file_path: &str,
    frontmatter_body_start: usize,
    archive_tag: &str,
) -> ScanResult {
    let lines: Vec<&str> = content.split('\n').collect();

    // Strip \r from line endings (handles CRLF)
    let lines: Vec<&str> = lines
        .iter()
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();

    // Find which line the body starts on (skip frontmatter lines)
    let body_start_line = find_body_start_line(&lines, frontmatter_body_start);

    let mut lists: Vec<DvListItem> = Vec::new();
    let mut headers: Vec<HeadingCacheItem> = Vec::new();

    let mut current_section_subpath = String::new();

    // Indent stack entries: (indent, line_num)
    let mut indent_stack: Vec<(usize, usize)> = Vec::new();

    let archive_tag_with_hash = format!("#{}", archive_tag);

    for line_num in body_start_line..lines.len() {
        let line = lines[line_num];
        if line.trim().is_empty() {
            continue;
        }

        // ── Header line ──────────────────────────────────────────────────────
        if let Some((level, heading_text)) = is_header(line) {
            let heading = heading_text.trim().to_string();

            let pos = HeadingPosition {
                start: HeadingPos { line: line_num, ch: 0 },
                end: HeadingPos { line: line_num, ch: line.len() },
            };
            headers.push(HeadingCacheItem {
                heading: heading.clone(),
                level,
                position: pos,
            });

            current_section_subpath = format!("#{}", heading);

            // Reset list indent stack on new section
            indent_stack.clear();
            continue;
        }

        // ── List item line ───────────────────────────────────────────────────
        let (indent, captured_text) = match is_list_item(line) {
            Some(v) => v,
            None => continue,
        };

        let mut text = captured_text.trim().to_string(); // FIRST trim point

        // Task detection
        let (is_task, is_completed) = match is_task(&text) {
            Some((completed, remainder)) => {
                text = remainder.trim().to_string(); // SECOND trim point
                (true, completed)
            }
            None => (false, false),
        };

        // rawText = text after task stripping, before meta stripping
        let raw_text = text.clone();

        // Strip meta-action and meta-mdtree from text
        text = strip_meta_action(&text);
        text = strip_meta_mdtree(&text);
        text = text.trim().to_string(); // THIRD trim point

        // Inline tag extraction
        let tags = extract_inline_tags(&text);

        // shouldSkip logic
        if (raw_text == text || text.is_empty()) && should_skip(&text, &archive_tag_with_hash) {
            continue;
        }

        // Parent wiring: pop stack entries with >= current indent
        while let Some(&(stack_indent, _)) = indent_stack.last() {
            if stack_indent >= indent {
                indent_stack.pop();
            } else {
                break;
            }
        }
        let parent_line_num = indent_stack.last().map(|&(_, ln)| ln);

        indent_stack.push((indent, line_num));

        lists.push(DvListItem {
            link: LinkRef { path: file_path.to_string() },
            text,
            raw_text,
            line: line_num,
            position: ListPosition {
                start: ListPos { line: line_num, col: indent },
                end: ListPos { line: line_num, col: line.len() },
            },
            parent: parent_line_num,
            children: Vec::new(),
            tags,
            section: Section { subpath: current_section_subpath.clone() },
            task: is_task,
            completed: is_completed,
        });
    }

    // Post-pass: wire children from parent line refs
    wire_children(&mut lists);

    ScanResult { lists, headers }
}

fn find_body_start_line(lines: &[&str], frontmatter_body_start: usize) -> usize {
    if frontmatter_body_start == 0 {
        return 0;
    }

    let mut chars = 0;
    for (i, line) in lines.iter().enumerate() {
        if chars >= frontmatter_body_start {
            return i;
        }
        chars += line.len() + 1; // +1 for newline
    }

    lines.len()
}

/// Wire the children arrays from parent line references.
/// This mirrors the post-pass in the TypeScript scanMarkdown.
fn wire_children(lists: &mut Vec<DvListItem>) {
    // Build a map of line_num → index in the flat list
    let mut line_to_index: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for (idx, item) in lists.iter().enumerate() {
        line_to_index.insert(item.line, idx);
    }

    // Collect parent-child relationships
    let mut children_map: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
    for (idx, item) in lists.iter().enumerate() {
        if let Some(parent_line) = item.parent {
            if let Some(&parent_idx) = line_to_index.get(&parent_line) {
                children_map.entry(parent_idx).or_default().push(idx);
            }
        }
    }

    // Now recursively build children (cloning items into parent's children vec)
    // We need to do this carefully since DvList children are full nested objects
    // matching the TypeScript output structure.
    // Strategy: build from leaves up, so each parent's children contains fully-resolved items.

    // First, find the order: we process items that have no children first.
    // Actually, the simplest correct approach is: clone child items into parent.
    // Since children can themselves have children, we need recursive resolution.
    // But in the flat list, items are in document order, and children always come AFTER parents.
    // So we can process in reverse order: for each item, clone it (with its already-resolved children) into its parent.

    // Process in reverse document order
    let len = lists.len();
    for i in (0..len).rev() {
        if let Some(parent_line) = lists[i].parent {
            if let Some(&parent_idx) = line_to_index.get(&parent_line) {
                let child_clone = lists[i].clone();
                lists[parent_idx].children.push(child_clone);
            }
        }
    }

    // Reverse children to maintain document order (since we processed in reverse)
    for item in lists.iter_mut() {
        item.children.reverse();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_header_detection() {
        let content = "# Alpha\n## Beta\n### Gamma";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.headers.len(), 3);
        assert_eq!(result.headers[0].heading, "Alpha");
        assert_eq!(result.headers[0].level, 1);
        assert_eq!(result.headers[1].heading, "Beta");
        assert_eq!(result.headers[1].level, 2);
        assert_eq!(result.headers[2].heading, "Gamma");
        assert_eq!(result.headers[2].level, 3);
    }

    #[test]
    fn header_line_numbers() {
        let content = "# First\n\n## Second";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.headers[0].position.start.line, 0);
        assert_eq!(result.headers[1].position.start.line, 2);
    }

    #[test]
    fn plain_text_not_header() {
        let content = "not a header\nalso not";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.headers.len(), 0);
    }

    #[test]
    fn header_trimmed() {
        let content = "# Hello   ";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.headers[0].heading, "Hello");
    }

    #[test]
    fn list_item_dash_prefix() {
        let content = "- [[Note]] text";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
        assert_eq!(result.lists[0].text, "[[Note]] text");
    }

    #[test]
    fn list_item_star_plus_prefix() {
        let content = "* [[A]]\n+ [[B]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 2);
    }

    #[test]
    fn numbered_list_items() {
        let content = "1. [[Item]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
    }

    #[test]
    fn pure_prose_skipped() {
        let content = "- just some text\n- more prose";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 0);
    }

    #[test]
    fn keeps_obsidian_links() {
        let content = "- [[Note]] is great";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
        assert_eq!(result.lists[0].text, "[[Note]] is great");
        assert_eq!(result.lists[0].raw_text, "[[Note]] is great");
    }

    #[test]
    fn keeps_http_urls() {
        let content = "- https://example.com";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
    }

    #[test]
    fn keeps_tagged_items() {
        let content = "- buy milk #todo";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
        assert_eq!(result.lists[0].tags, vec!["#todo"]);
    }

    #[test]
    fn multiple_tags_extracted() {
        let content = "- [[link]] #foo #bar/baz";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].tags, vec!["#foo", "#bar/baz"]);
    }

    #[test]
    fn task_uncompleted() {
        let content = "- [ ] review [[Note]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
        assert!(result.lists[0].task);
        assert!(!result.lists[0].completed);
    }

    #[test]
    fn task_completed_lowercase() {
        let content = "- [x] [[Done]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert!(result.lists[0].completed);
    }

    #[test]
    fn task_completed_uppercase() {
        let content = "- [X] [[Also done]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert!(result.lists[0].completed);
    }

    #[test]
    fn task_prefix_stripped_from_text() {
        let content = "- [ ] do [[Something]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].text, "do [[Something]]");
    }

    #[test]
    fn pure_prose_task_skipped() {
        let content = "- [ ] plain task text";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 0);
    }

    #[test]
    fn keep_task_reference() {
        // Item text contains "- [" pattern — should NOT be skipped
        let content = "- see item - [x] done";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
    }

    #[test]
    fn parent_wiring_single_level() {
        let content = "- [[Parent]]\n  - [[Child]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 2);
        assert_eq!(result.lists[1].parent, Some(0)); // child's parent is line 0
    }

    #[test]
    fn parent_wiring_deep() {
        let content = "- [[A]]\n  - [[B]]\n    - [[C]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 3);
        assert_eq!(result.lists[0].parent, None);
        assert_eq!(result.lists[1].parent, Some(0));
        assert_eq!(result.lists[2].parent, Some(1));
    }

    #[test]
    fn sibling_items_no_parent() {
        let content = "- [[A]]\n- [[B]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].parent, None);
        assert_eq!(result.lists[1].parent, None);
    }

    #[test]
    fn dedent_resets_parent() {
        let content = "- [[A]]\n  - [[B]]\n- [[C]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[2].parent, None);
    }

    #[test]
    fn children_post_pass() {
        let content = "- [[Parent]]\n  - [[Child A]]\n  - [[Child B]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].children.len(), 2);
        assert_eq!(result.lists[0].children[0].text, "[[Child A]]");
        assert_eq!(result.lists[0].children[1].text, "[[Child B]]");
    }

    #[test]
    fn section_subpath_from_header() {
        let content = "# Setup\n\n- [[Config]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].section.subpath, "#Setup");
    }

    #[test]
    fn section_empty_before_header() {
        let content = "- [[A]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].section.subpath, "");
    }

    #[test]
    fn section_updates_on_new_header() {
        let content = "# First\n\n- [[A]]\n\n# Second\n\n- [[B]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].section.subpath, "#First");
        assert_eq!(result.lists[1].section.subpath, "#Second");
    }

    #[test]
    fn indent_stack_resets_on_header() {
        let content = "- [[Pre]]\n  - [[Nested]]\n# New\n- [[Post]]";
        let result = scan_markdown(content, "test.md", 0, "archive");
        // [[Post]] should have no parent because header reset indent stack
        let post_item = result.lists.iter().find(|i| i.text == "[[Post]]").unwrap();
        assert_eq!(post_item.parent, None);
    }

    #[test]
    fn archive_tag_skips_item() {
        let content = "- [[Note]] #archive";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 0);
    }

    #[test]
    fn archive_tag_different_tag_kept() {
        let content = "- [[Note]] #todo";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
    }

    #[test]
    fn frontmatter_body_start_offset() {
        let content = "---\ntitle: hi\n---\n- [[Real Item]]";
        // frontmatter_body_start = 18 means the body starts after "---\ntitle: hi\n---\n"
        let result = scan_markdown(content, "test.md", 18, "archive");
        assert_eq!(result.lists.len(), 1);
        assert_eq!(result.lists[0].text, "[[Real Item]]");
        assert_eq!(result.lists[0].line, 3);
    }

    #[test]
    fn meta_action_stripped_from_text() {
        let content = "- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)(meta-action-icon::globe-01-16)";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists.len(), 1);
        assert_eq!(result.lists[0].text, "https://example.com");
    }

    #[test]
    fn meta_action_preserved_in_raw_text() {
        let content = "- https://example.com (meta-action-name::Open)(meta-action-url::https://x.com)";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert!(result.lists[0].raw_text.contains("meta-action-name::Open"));
    }

    #[test]
    fn meta_action_only_skipped() {
        let content = "- (meta-action-name::X)(meta-action-url::https://x.com)";
        let result = scan_markdown(content, "test.md", 0, "archive");
        // After stripping meta-action, text is empty → should be skipped
        assert_eq!(result.lists.len(), 0);
    }

    #[test]
    fn plain_text_with_meta_action_kept() {
        let content = "- Buy milk (meta-action-name::Open Task)(meta-action-url::https://todoist.com/task/1)(meta-action-icon::globe-01-16)";
        let result = scan_markdown(content, "test.md", 0, "archive");
        // rawText != text (meta was stripped), so shouldSkip is NOT applied
        assert_eq!(result.lists.len(), 1);
        assert_eq!(result.lists[0].text, "Buy milk");
    }

    #[test]
    fn meta_mdtree_stripped() {
        let content = "- My archived item (meta-mdtree:: archive)";
        let result = scan_markdown(content, "test.md", 0, "archive");
        // rawText != text (meta was stripped), so shouldSkip is bypassed
        assert_eq!(result.lists.len(), 1);
        assert_eq!(result.lists[0].text, "My archived item");
        assert!(result.lists[0].raw_text.contains("meta-mdtree:: archive"));
    }

    #[test]
    fn crlf_line_endings() {
        let content = "# Header\r\n\r\n- [[Note]] text\r\n  - [[Child]] sub";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.headers.len(), 1);
        assert_eq!(result.headers[0].heading, "Header");
        assert_eq!(result.lists.len(), 2);
        assert_eq!(result.lists[0].text, "[[Note]] text");
        assert_eq!(result.lists[1].parent, Some(2));
    }

    #[test]
    fn link_path_set_from_argument() {
        let content = "- [[Note]]";
        let result = scan_markdown(content, "folder/my-file.md", 0, "archive");
        assert_eq!(result.lists[0].link.path, "folder/my-file.md");
    }

    #[test]
    fn position_fields_correct() {
        let content = "  - [[Note]] text";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].position.start.line, 0);
        assert_eq!(result.lists[0].position.start.col, 2); // indent = 2
        assert_eq!(result.lists[0].position.end.line, 0);
        assert_eq!(result.lists[0].position.end.col, 17); // line.len() = 17
    }

    #[test]
    fn task_raw_text_is_post_task_pre_meta() {
        let content = "- [ ] do [[thing]] (meta-action-name::Open)(meta-action-url::https://x.com)";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].raw_text, "do [[thing]] (meta-action-name::Open)(meta-action-url::https://x.com)");
        assert_eq!(result.lists[0].text, "do [[thing]]");
    }

    #[test]
    fn trailing_whitespace_on_list_item() {
        let content = "- [[Note]]   ";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.lists[0].text, "[[Note]]");
        assert_eq!(result.lists[0].raw_text, "[[Note]]");
    }

    #[test]
    fn seven_hashes_not_header() {
        // Only h1-h6 are valid headers
        let content = "####### not a header";
        let result = scan_markdown(content, "test.md", 0, "archive");
        assert_eq!(result.headers.len(), 0);
    }
}
