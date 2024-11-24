/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Obsidian Socket Path - Go to Obsidian -> Settings -> Community Plugin -> Tree Search Settings -> Socket Path */
  "socketPath": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `bookmarks` command */
  export type Bookmarks = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `bookmarks` command */
  export type Bookmarks = {}
}

