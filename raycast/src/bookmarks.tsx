import {
  Action,
  ActionPanel,
  getPreferenceValues,
  Icon,
  List,
} from "@raycast/api";
import { ReactNode, useEffect, useState } from "react";
import { searchBookmarks, VaultResults } from "./fetch";
import debounce from "lodash.debounce";
import { ResultNode } from "obsidian-tree-search/src/search";
import React from "react";
import { Token } from "markdown-it/index.js";

export interface Preferences {
  socketPath: string;
}

type TreeNodeSearchProps = {
  node: ResultNode;
  vault: string;
  vaultColor: string;
  level: number;
  minExpand: number;
};

function getVaultColor(vault: string, vaults: string[]): string {
  if (vaults.length == 1) return "";

  const idx = vaults.indexOf(vault);
  if (idx == -1) return "🌕";
  return ["🔵", "🟢", "🟠", "🟣", "🔴", "🟡"][idx % 6];
}

export const IndividualListItem = (props: TreeNodeSearchProps) => {
  const item = props.node;
  const actionsAccumulator: ReactNode[] = [];
  const tokenText = RaycastTokenRenderer(
    item.attrs.tokens,
    actionsAccumulator,
    props.vault,
  );
  actionsAccumulator.push(
    <AdvancedUriAction item={item} vault={props.vault} />,
  ); // default open action

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
      accessories={[
        { icon: getIcon(item), tooltip: item.attrs.nodeType },
        { text: props.vaultColor, tooltip: props.vault },
      ]}
      detail={
        <List.Item.Detail
          markdown={`
**${item.value}**
    
- url: ${item.value}
- src: ${getMarkdownUri(item.attrs.location, props.vault)}
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
      <IndividualListItem key={props.node.index} {...props} />
      {props.node.children.map((child, idx) => (
        <RaycastTreeList
          key={`ct${idx}`}
          node={child}
          level={props.level + 1}
          vault={props.vault}
          vaultColor={props.vaultColor}
          minExpand={props.minExpand}
        />
      ))}
    </>
  );
};

export default function Command() {
  const [searchText, setSearchText] = useState("");

  const [filtered, setFiltered] = useState<VaultResults[]>([]);

  const debouncer = debounce(async (searchText: string) => {
    if (!searchText) {
      return;
    }

    const result = await searchBookmarks(
      searchText,
      getPreferenceValues<Preferences>(),
    );
    setFiltered(result);
  }, 100);

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
      {filtered.flatMap((vault) =>
        vault.results.nodes.map((item, idx) => (
          <RaycastTreeList
            key={`t${vault.vault}${idx}`}
            vaultColor={getVaultColor(
              vault.vault,
              filtered.map((it) => it.vault),
            )}
            vault={vault.vault}
            node={item}
            level={0}
            minExpand={5}
          />
        )),
      )}
    </List>
  );
}

function AdvancedUriAction(props: { item: ResultNode; vault: string }) {
  const item = props.item;
  return (
    <>
      <Action.OpenInBrowser
        title="See in Obsidian"
        url={getUrl(item.attrs.location, props.vault)}
        shortcut={{ modifiers: ["shift"], key: "enter" }}
        icon={Icon.Pencil}
      />
      <Action.CopyToClipboard
        title="Copy to clipboard"
        content={item.value}
        shortcut={{ modifiers: ["cmd"], key: "c" }}
        icon={Icon.Clipboard}
      />
    </>
  );
}

function getMarkdownUri(
  location: ResultNode["attrs"]["location"],
  vault: string,
) {
  return `[${location.path}](${getUrl(location, vault)})`;
}

function getUrl(item: ResultNode["attrs"]["location"], vault: string): string {
  const uri = `vault=${vault}&filepath=${item.path}&line=${item.position.start.line + 1}&column=${item.position.start.ch + 1}`;
  return `obsidian://adv-uri?${encodeURI(uri)}`;
}

function RaycastTokenRenderer(
  tokens: Token[],
  actions: ReactNode[],
  vault: string,
): string {
  if (tokens.length == 0) return "";

  const token = tokens[0];

  if (token.type == "inline" && token.children) {
    return RaycastTokenRenderer(token.children, actions, vault);
  }

  if (token.type == "obsidian_link") {
    let fileName = token.content.split("|")[0];
    fileName = fileName.split("#")[0];

    actions.push(
      <Action.OpenInBrowser
        title={`Open 🔹${token.content}`}
        url={`obsidian://open?vault=${vault}&file=${fileName}`}
      />,
    );

    return (
      "🔹" +
      token.content +
      RaycastTokenRenderer(tokens.slice(1), actions, vault)
    );
  }

  if (token.type == "link_open") {
    const href = decodeURI(token.attrs?.[0]?.[1] || "#");
    const content = tokens[1]?.content;

    actions.push(
      <Action.OpenInBrowser title={`Browse 🔗${content}`} url={href} />,
    );

    return (
      "🔗 " + content + RaycastTokenRenderer(tokens.slice(2), actions, vault)
    );
  }

  if (token.type == "link_close") {
    return RaycastTokenRenderer(tokens.slice(1), actions, vault);
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
        "🔗 " +
        token.content +
        RaycastTokenRenderer(tokens.slice(1), actions, vault)
      );
    }
    return (
      token.content + RaycastTokenRenderer(tokens.slice(1), actions, vault)
    );
  }

  if (token.type == "strong_open") {
    return (
      token.content + RaycastTokenRenderer(tokens.slice(1), actions, vault)
    );
  }

  if (token.type == "strong_close") {
    return (
      token.content + RaycastTokenRenderer(tokens.slice(1), actions, vault)
    );
  }

  if (token.type == "em_open") {
    return (
      token.content + RaycastTokenRenderer(tokens.slice(1), actions, vault)
    );
  }

  if (token.type == "softbreak") {
    return (
      token.content + RaycastTokenRenderer(tokens.slice(1), actions, vault)
    );
  }

  if (token.type == "s_open") {
    return (
      token.content + RaycastTokenRenderer(tokens.slice(1), actions, vault)
    );
  }

  if (token.type == "image") {
    return (
      "🖼️ " +
      token.content +
      RaycastTokenRenderer(tokens.slice(1), actions, vault)
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
      "📋 " +
      token.content +
      RaycastTokenRenderer(tokens.slice(1), actions, vault)
    );
  }

  // if (!token.type.includes("_close")) console.log("tokens not rendered: ", tokens)

  return token.content + RaycastTokenRenderer(tokens.slice(1), actions, vault);
}
