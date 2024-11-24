import {
  Action,
  ActionPanel,
  getPreferenceValues,
  Icon,
  List,
} from "@raycast/api";
import { ReactNode, useEffect, useState } from "react";
import { searchBookmarks } from "./fetch";
import debounce from "lodash.debounce";
import { IndexedResult, ResultNode } from "obsidian-tree-search/src/search";
import React from "react";
import { Token } from "markdown-it/index.js";

export interface Preferences {
  socketPath: string;
}

type TreeNodeSearchProps = {
  node: ResultNode;
  level: number;
  minExpand: number;
};

export const IndividualListItem = (props: TreeNodeSearchProps) => {
  const item = props.node;
  const actionsAccumulator: ReactNode[] = [];
  const tokenText = RaycastTokenRenderer(item.attrs.tokens, actionsAccumulator);
  actionsAccumulator.push(<AdvancedUriAction item={item} />); // default open action

  function getIcon(item: ResultNode) {
    if (
      item.attrs.nodeType == "page" ||
      item.attrs.nodeType == "virtual-page"
    ) {
      return Icon.Document;
    }

    if (
      item.attrs.nodeType == "task" ||
      item.attrs.nodeType == "completed-task"
    ) {
      return Icon.Checkmark;
    }

    if (item.attrs.nodeType == "header") {
      return Icon.Hashtag;
    }

    return Icon.Text;
  }

  return (
    <List.Item
      key={item.value}
      title={`${props.level > 0 ? "|" : ""}${"–".repeat(props.level)} ${tokenText}`}
      // subtitle={{ value: item.parents.join(",")}}
      // keywords={item.attrs.searchKey.split(" ")}
      accessories={[{ icon: getIcon(item), tooltip: item.attrs.nodeType }]}
      // icon={getIcon(item)}
      detail={
        <List.Item.Detail
          markdown={`
**${item.value}**
    
- url: ${item.value}
- src: ${getMarkdownUri(item.attrs.location)}
- tag: ${item.attrs.tags}
    `}
        />
      }
      actions={<ActionPanel>{...actionsAccumulator}</ActionPanel>}
    />
  );
};

export const RaycastTreeList = (props: TreeNodeSearchProps) => {
  return (
    <>
      <IndividualListItem {...props} />
      {props.node.children.map((child) => (
        <RaycastTreeList
          node={child}
          level={props.level + 1}
          minExpand={props.minExpand}
        />
      ))}
    </>
  );
};

export default function Command() {
  const [searchText, setSearchText] = useState("");

  const [filtered, setFiltered] = useState<IndexedResult>({
    nodes: [],
    total: 0,
  });

  const debouncer = debounce(async (searchText: string) => {
    if (!searchText) {
      return;
    }

    const result = await searchBookmarks(
      searchText,
      getPreferenceValues<Preferences>(),
    );
    setFiltered(result.data);
  }, 300);

  useEffect(() => {
    debouncer(searchText);

    return () => {
      debouncer.cancel();
    };
  }, [searchText]);

  return (
    <List
      navigationTitle="Tree Search"
      searchBarPlaceholder="Obsidian Tree Search"
      filtering={false}
      // throttle={true}
      onSearchTextChange={setSearchText}
      isShowingDetail={false}
    >
      {filtered.nodes.map((item) => (
        <RaycastTreeList node={item} level={0} minExpand={5} />
      ))}
    </List>
  );
}

function AdvancedUriAction(props: { item: ResultNode }) {
  const item = props.item;
  return (
    <Action.OpenInBrowser
      title="See in Obsidian"
      url={getUrl(item.attrs.location)}
      icon={Icon.Pencil}
    />
  );
}

function getMarkdownUri(location: ResultNode["attrs"]["location"]) {
  return `[${location.path}](${getUrl(location)})`;
}

function getUrl(item: ResultNode["attrs"]["location"]): string {
  const uri = `filepath=${item.path}&line=${item.position.start.line + 1}&column=${item.position.start.ch + 1}`;
  return `obsidian://adv-uri?${encodeURI(uri)}`;
}

function RaycastTokenRenderer(tokens: Token[], actions: ReactNode[]): string {
  if (tokens.length == 0) return "";

  const token = tokens[0];

  if (token.type == "inline" && token.children) {
    return RaycastTokenRenderer(token.children, actions);
  }

  if (token.type == "obsidian_link") {
    let fileName = token.content.split("|")[0];
    fileName = fileName.split("#")[0];

    actions.push(
      <Action.OpenInBrowser
        title={`Open 🔹${token.content}`}
        url={`obsidian://open?file=${fileName}`}
      />,
    );

    return (
      "🔹" + token.content + RaycastTokenRenderer(tokens.slice(1), actions)
    );
  }

  if (token.type == "link_open") {
    const href = token.attrs?.[0]?.[1] || "#";
    const content = tokens[1]?.content;

    actions.push(
      <Action.OpenInBrowser title={`Browse 🔗${content}`} url={href} />,
    );

    return "🔗 " + content + RaycastTokenRenderer(tokens.slice(2), actions);
  }

  if (token.type == "link_close") {
    return RaycastTokenRenderer(tokens.slice(1), actions);
  }

  if (token.type == "text") {
    if (token.content.trim().startsWith("http")) {
      actions.push(
        <Action.OpenInBrowser
          title={`Browse 🔗${token.content}`}
          url={token.content.trim()}
        />,
      );

      return (
        "🔗 " + token.content + RaycastTokenRenderer(tokens.slice(1), actions)
      );
    }
    return token.content + RaycastTokenRenderer(tokens.slice(1), actions);
  }

  if (token.type == "strong_open") {
    return token.content + RaycastTokenRenderer(tokens.slice(1), actions);
  }

  if (token.type == "strong_close") {
    return token.content + RaycastTokenRenderer(tokens.slice(1), actions);
  }

  if (token.type == "em_open") {
    return token.content + RaycastTokenRenderer(tokens.slice(1), actions);
  }

  if (token.type == "softbreak") {
    return token.content + RaycastTokenRenderer(tokens.slice(1), actions);
  }

  if (token.type == "s_open") {
    return token.content + RaycastTokenRenderer(tokens.slice(1), actions);
  }

  if (token.type == "image") {
    return (
      "🖼️ " + token.content + RaycastTokenRenderer(tokens.slice(1), actions)
    );
  }

  if (token.type == "code_inline") {
    actions.push(
      <Action.CopyToClipboard
        title={`Copy ${token.content} to clipboard`}
        content={token.content}
      />,
    );
    return (
      "📋 " + token.content + RaycastTokenRenderer(tokens.slice(1), actions)
    );
  }

  // if (!token.type.includes("_close")) console.log("tokens not rendered: ", tokens)

  return token.content + RaycastTokenRenderer(tokens.slice(1), actions);
}
