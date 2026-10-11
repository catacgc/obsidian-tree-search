// The chain prompt between the search bar and the results: for Move to (`<`, also Alt+M and the action panel, in
// every view), where the row goes; for an append chain (`>`), what Enter writes and the note patches it applies.
import {useAtomValue} from "jotai"
import {useMolecule} from "bunshi/react"
import {describePatch, INVALID_NAME_RE, localIsoDate, NAMES_HINT, planOutlinePatches, renderOutline} from "@mdtree/core"
import {SearchViewMolecule} from "../react-context/state"
import {GlobalAtoms} from "../react-context/global"
import {basenameOf, dailyConfigOf} from "../editor/draft"
import {dailyNotePath} from "../../editing/vault-edits"
import {MarkdownLine} from "../editor/MarkdownLine"
import {canMoveUnderNewPage, type ChainOutline} from "./chain"

export const ChainPreview = () => {
    const {chainAtom, chainWriteAtom, actualQueryAtom, renderableTreeNodesAtom} = useMolecule(SearchViewMolecule)
    const chain = useAtomValue(chainAtom)
    const write = useAtomValue(chainWriteAtom)
    const query = useAtomValue(actualQueryAtom)
    const rows = useAtomValue(renderableTreeNodesAtom)

    if (!chain) return null
    if (chain.mode === "append") {
        if (write === null) return null
        if ("error" in write) return <div className="ts-chain-preview is-blocking"><div className="ts-chain-preview-dest">{write.error}</div></div>
        return <AppendPreview write={write}/>
    }
    const q = query.trim()
    let message: string | null = null
    if (q.length < 3) message = "Type 3+ characters"
    else if (rows.length === 0 && !canMoveUnderNewPage(chain.child.node)) message = "No matching folder"
    else if (rows.length === 0) {
        if (INVALID_NAME_RE.test(q)) message = NAMES_HINT
        else if (chain.confirm === q) message = `Create [[${q}]] and move ${chain.child.label} under it? Press Enter again`
        else message = `No match — press Enter to create [[${q}]]`
    }
    if (!message) return null
    return <div className="ts-chain-preview is-reparent"><div className="ts-chain-preview-dest">{message}</div></div>
}

const AppendPreview = ({write}: {write: ChainOutline}) => {
    const app = useAtomValue(GlobalAtoms.appAtom)
    const index = useAtomValue(GlobalAtoms.indexAtom)
    const dailyPath = dailyNotePath(dailyConfigOf(index))
    const planned = planOutlinePatches(write.lines, {dropPatchOnlyRoots: !write.underLine})
    const today = localIsoDate(new Date())
    const dest = planned.lines.length === 0 ? "Changes the notes only — nothing is added to an outline"
        : write.underLine ? `Under "${write.underLine.label}" in ${basenameOf(write.underLine.path)} · dated ${today}`
        : write.parentName ? `Today's daily note, under [[${write.parentName}]] · dated ${today}`
        : `Today's daily note · dated ${today}`
    const hints = planned.patches.flatMap(p => describePatch(p, !!app.metadataCache.getFirstLinkpathDest(p.name, "")))
    return <div className="ts-chain-preview">
        <div className="ts-chain-preview-dest">{dest}</div>
        {planned.lines.length > 0 && <div className="ts-editor-preview">
            <MarkdownLine app={app} text={renderOutline(planned.lines, 0).join("\n")} sourcePath={write.underLine?.path ?? dailyPath}/>
        </div>}
        {hints.map(h => <div key={h} className="ts-chain-preview-hint">{h}</div>)}
        <div className="ts-chain-preview-hint">Enter adds · Alt+Enter opens the editor · paste text or images to continue there</div>
    </div>
}
