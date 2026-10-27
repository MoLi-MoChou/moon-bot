// The first start: where Moon Bot keeps its data and the Bots' files. The answers are kept in
// the app's own data.
import { app, dialog } from 'electron'
import type { MessageBoxOptions } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { within } from './copy-tree.ts'
import { installFolder, userDshHome } from './move-data.ts'

export interface FirstRunText {
  readonly welcome: string
  readonly places: (data: string, workspace: string) => string
  readonly start: string
  readonly change: string
  readonly pickData: string
  readonly pickWorkspace: string
  readonly dataInWorkspace: string
  readonly workspaceInData: string
  readonly inDsh: (home: string) => string
  readonly inProgram: string
  readonly pickMove: string
  readonly moveDrive: string
  readonly moveNested: string
  readonly moveWorkspace: string
  readonly moveNotEmpty: string
  readonly moveConfirm: (to: string) => string
  readonly moveDetail: (from: string) => string
  readonly move: string
  readonly cancel: string
  readonly moving: string
  readonly starting: string
  readonly moveInUse: string
  readonly moveFailed: (message: string) => string
  readonly quit: string
  readonly notStarted: string
}

const TEXT: Readonly<Record<'en' | 'zh', FirstRunText>> = {
  en: {
    welcome: 'Welcome to Moon Bot',
    places: (data, workspace) => `Data: ${data}\nTeam workspace: ${workspace}`,
    start: 'Start', change: 'Change…',
    pickData: 'Folder for Moon Bot data', pickWorkspace: 'Folder for the team workspace',
    dataInWorkspace: 'The data folder cannot be inside the team workspace.',
    workspaceInData: 'The team workspace cannot be inside the data folder.',
    inDsh: home => `Choose a folder outside another app's data (${home}).`,
    inProgram: 'Choose a folder outside the program folder: uninstalling removes it.',
    pickMove: 'New folder for Moon Bot data',
    moveDrive: 'Choose a folder, not a whole drive.',
    moveNested: 'Choose a folder outside the current data folder.',
    moveWorkspace: 'The data folder and the team workspace cannot hold each other.',
    moveNotEmpty: 'Choose an empty folder or a new one.',
    moveConfirm: to => `Move Moon Bot's data to ${to}?`,
    moveDetail: from => `Moon Bot copies its data there and starts again. ${from} stays as it is; you can delete it once everything works.`,
    move: 'Move and restart', cancel: 'Cancel',
    moving: 'Copying Moon Bot\'s data…',
    starting: 'Starting Moon Bot…',
    moveInUse: 'Moon Bot is using this data, so it was not moved. Close it, then try again.',
    moveFailed: message => `The data could not be copied: ${message}\n\nMoon Bot goes on with its data where it was.`,
    quit: 'Quit',
    notStarted: 'Moon Bot could not start.',
  },
  zh: {
    welcome: '欢迎使用 Moon Bot',
    places: (data, workspace) => `数据：${data}\n总工作区：${workspace}`,
    start: '开始使用', change: '更改位置…',
    pickData: '选择 Moon Bot 的数据文件夹', pickWorkspace: '选择总工作区的文件夹',
    dataInWorkspace: '数据文件夹不能放在总工作区里面。',
    workspaceInData: '总工作区不能放在数据文件夹里面。',
    inDsh: home => `请选择其他应用的数据（${home}）以外的文件夹。`,
    inProgram: '请选择程序文件夹以外的位置：卸载时会删掉程序文件夹。',
    pickMove: '选择 Moon Bot 数据的新文件夹',
    moveDrive: '请选择一个文件夹，不要选整个磁盘。',
    moveNested: '请选择现在的数据文件夹以外的位置。',
    moveWorkspace: '数据文件夹和总工作区不能互相包含。',
    moveNotEmpty: '请选择一个空文件夹，或者新建一个。',
    moveConfirm: to => `把 Moon Bot 的数据移到 ${to} 吗？`,
    moveDetail: from => `Moon Bot 会把数据复制过去，然后重新启动。${from} 会原样保留，确认一切正常后可以自己删掉。`,
    move: '移动并重启', cancel: '取消',
    moving: '正在复制 Moon Bot 的数据…',
    starting: '正在启动 Moon Bot…',
    moveInUse: 'Moon Bot 正在使用这份数据，所以没有移动。请先关掉它，再重试。',
    moveFailed: message => `数据没有复制成功：${message}\n\nMoon Bot 会继续使用原来位置的数据。`,
    quit: '退出',
    notStarted: 'Moon Bot 没能启动。',
  },
}
export const localeText = <T>(table: Readonly<Record<'zh' | 'en', T>>): T => (app.getLocale().toLowerCase().startsWith('zh') ? table.zh : table.en)
export const text = (): FirstRunText => localeText(TEXT)

const locationsFile = (): string => join(app.getPath('userData'), 'locations.json')

// A quit request while a first-run dialog is open stops the first run right after that dialog.
class Quit extends Error {}

async function ask(options: MessageBoxOptions, signal: AbortSignal): Promise<number> {
  const { response } = await dialog.showMessageBox({ title: 'Moon Bot', noLink: true, ...options, signal })
  // A quit that arrived while a synchronous macOS box was open gets to run first.
  await new Promise<void>(resolve => setImmediate(resolve))
  if (signal.aborted) throw new Quit()
  return response
}

async function pick(title: string, current: string, signal: AbortSignal): Promise<string> {
  const { canceled, filePaths } = await dialog.showOpenDialog({ title, defaultPath: existsSync(current) ? current : dirname(current), properties: ['openDirectory', 'createDirectory', 'promptToCreate'] })
  await new Promise<void>(resolve => setImmediate(resolve))
  if (signal.aborted) throw new Quit()
  return canceled || filePaths[0] === undefined ? current : filePaths[0]
}

export const programFolder = (): string => installFolder(app.getPath('exe'))

function placeProblem(t: FirstRunText, dataDir: string, workspace: string): string | undefined {
  const other = userDshHome()
  const program = programFolder()
  if (within(dataDir, workspace)) return t.dataInWorkspace
  if (within(workspace, dataDir)) return t.workspaceInData
  for (const path of [dataDir, workspace]) {
    if (within(path, other) || within(other, path)) return t.inDsh(other)
    if (app.isPackaged && within(path, program)) return t.inProgram
  }
  return undefined
}

/** The places the app keeps its data, as written by the first run. */
export interface SavedPlaces {
  readonly dataDir: string
  readonly workspace?: string | undefined
}

/** Write the chosen places once the first run is finished; quitting before that asks again. */
export function saveLocations({ dataDir, workspace }: SavedPlaces): void {
  const file = locationsFile()
  mkdirSync(dirname(file), { recursive: true })
  // A write that fails half way leaves the places that were there.
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ dataDir, workspace }, null, 2)}\n`)
  renameSync(`${file}.tmp`, file)
}

/** What the first run chose: the places, or `quit` when the user left. */
export type FirstRunResult = SavedPlaces | { readonly quit: true }

/**
 * Where the app keeps its data and the Bots' files, asked at the first start.
 * A run on throwaway folders (MOON_BOT_DATA, for development and tests) asks nothing.
 */
export async function chooseLocations(signal: AbortSignal): Promise<FirstRunResult> {
  const throwaway = process.env.MOON_BOT_DATA
  if (throwaway) return { dataDir: throwaway, workspace: process.env.MOON_BOT_WORKSPACE || undefined }
  const file = locationsFile()
  // Before the Moon Bot rename the app was "Mochou" or "DSH Bot": their saved places still apply.
  const legacy = ['Mochou', 'DSH Bot'].map(name => join(app.getPath('appData'), name, 'locations.json')).find(path => existsSync(path))
  if (!existsSync(file) && legacy !== undefined) {
    return JSON.parse(readFileSync(legacy, 'utf8')) as SavedPlaces
  }
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8')) as SavedPlaces
  }
  const t = text()
  // Moon Bot patch: its own data folder, apart from a DS Bot install.
  let dataDir = join(homedir(), '.moon-bot')
  let workspace = join(homedir(), 'Moon Bot')
  try {
    for (;;) {
      const choice = await ask({ type: 'info', message: t.welcome, detail: t.places(dataDir, workspace), buttons: [t.start, t.change, t.quit], defaultId: 0, cancelId: 2 }, signal)
      if (choice === 2) return { quit: true }
      if (choice === 1) {
        dataDir = await pick(t.pickData, dataDir, signal)
        workspace = await pick(t.pickWorkspace, workspace, signal)
        continue
      }
      const problem = placeProblem(t, dataDir, workspace)
      if (problem === undefined) break
      await ask({ type: 'warning', message: problem, buttons: ['OK'] }, signal)
    }
  } catch (error) {
    if (error instanceof Quit) return { quit: true }
    throw error
  }
  saveLocations({ dataDir, workspace })
  return { dataDir, workspace }
}
