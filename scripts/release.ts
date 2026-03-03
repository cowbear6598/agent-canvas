import { readFileSync, writeFileSync, unlinkSync } from "fs"
import { spawnSync } from "child_process"

type ReleaseType = "patch" | "minor" | "major"

const PACKAGE_JSON_PATHS = ["./package.json", "./backend/package.json"]
const CHANGELOG_PATH = "./CHANGELOG.md"
const RELEASE_NOTES_TMP = "./.release-notes.tmp"

function parseVersion(version: string): [number, number, number] {
  const parts = version.split(".").map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    console.error(`無效的版本號格式：${version}`)
    process.exit(1)
  }
  return [parts[0], parts[1], parts[2]]
}

function bumpVersion(current: string, type: ReleaseType): string {
  const [major, minor, patch] = parseVersion(current)

  switch (type) {
    case "major":
      return `${major + 1}.0.0`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "patch":
      return `${major}.${minor}.${patch + 1}`
  }
}

function readJson(path: string): Record<string, unknown> {
  const content = readFileSync(path, "utf-8")
  return JSON.parse(content) as Record<string, unknown>
}

function writeJson(path: string, data: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8")
}

function updatePackageVersions(newVersion: string): void {
  for (const pkgPath of PACKAGE_JSON_PATHS) {
    const pkg = readJson(pkgPath)
    pkg.version = newVersion
    writeJson(pkgPath, pkg)
    console.log(`已更新 ${pkgPath} 版本號為 ${newVersion}`)
  }
}

function extractChangelogSection(version: string): string {
  const content = readFileSync(CHANGELOG_PATH, "utf-8")
  const lines = content.split("\n")

  let inSection = false
  const sectionLines: string[] = []

  for (const line of lines) {
    if (line.startsWith(`## [${version}]`)) {
      inSection = true
      sectionLines.push(line)
      continue
    }

    if (inSection && line.startsWith("## [")) {
      break
    }

    if (inSection) {
      sectionLines.push(line)
    }
  }

  if (sectionLines.length === 0) {
    console.error(`在 CHANGELOG.md 中找不到版本 [${version}] 的內容`)
    process.exit(1)
  }

  return sectionLines.join("\n").trimEnd()
}

function runCommand(command: string, args: string[]): void {
  console.log(`執行：${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) {
    console.error(`指令執行失敗：${command} ${args.join(" ")}`)
    process.exit(1)
  }
}

const releaseType = process.argv[2] as ReleaseType

if (!["patch", "minor", "major"].includes(releaseType)) {
  console.error("用法：bun run scripts/release.ts <patch|minor|major>")
  process.exit(1)
}

const rootPkg = readJson("./package.json")
const currentVersion = rootPkg.version as string
const newVersion = bumpVersion(currentVersion, releaseType)

console.log(`目前版本：${currentVersion}`)
console.log(`新版本：${newVersion}（${releaseType}）`)

updatePackageVersions(newVersion)

const changelogContent = extractChangelogSection(newVersion)
writeFileSync(RELEASE_NOTES_TMP, changelogContent, "utf-8")
console.log(`已將 CHANGELOG 內容寫入 ${RELEASE_NOTES_TMP}`)

runCommand("git", ["add", ...PACKAGE_JSON_PATHS, CHANGELOG_PATH])
runCommand("git", ["commit", "-m", `[Release] v${newVersion}`])
runCommand("git", ["tag", `v${newVersion}`])

try {
  runCommand("git", ["push"])
  runCommand("git", ["push", "--tags"])
} finally {
  try { unlinkSync(RELEASE_NOTES_TMP) } catch {}
  console.log(`已清理 ${RELEASE_NOTES_TMP}`)
}

console.log(`發布完成：v${newVersion}`)
