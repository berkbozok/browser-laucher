#!/bin/sh
# Builds "Browser Launcher.app": double-click it to start the launcher and
# open its page, with no terminal involved. Quit it from the Dock to stop.
#
#   npm run make-app                 -> dist/Browser Launcher.app
#   npm run make-app -- ~/Applications/"Browser Launcher.app"
#
# The app runs this copy of the project, so keep the folder where it is (or
# run this again after moving it). It listens on its own port, 3210, so it
# never collides with "npm run dev".
set -eu

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$PROJECT/dist/Browser Launcher.app}"
PORT="${PORT:-3210}"

if ! command -v node >/dev/null 2>&1; then
  echo "node isn't on your PATH; install Node.js first." >&2
  exit 1
fi
# An app started from Finder doesn't get your shell's PATH, so remember
# where node lives.
NODE_DIR="$(dirname "$(command -v node)")"

SOURCE="$(mktemp -t browser-launcher-app).applescript"
trap 'rm -f "$SOURCE"' EXIT

# Paths are passed in as quoted AppleScript strings; escape \ and " in them.
as_string() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

cat > "$SOURCE" <<APPLESCRIPT
property projectPath : "$(as_string "$PROJECT")"
property nodeDir : "$(as_string "$NODE_DIR")"
property portNumber : "$PORT"
property serverPid : ""

on pageAddress()
	return "http://127.0.0.1:" & portNumber
end pageAddress

on isUp()
	try
		do shell script "/usr/bin/curl -s -m 2 -o /dev/null " & pageAddress() & "/api/browsers"
		return true
	on error
		return false
	end try
end isUp

on startServer()
	-- Rebuild when the code is newer than the last build, then start the
	-- server in the background and hand back its process id.
	set shellCommand to "cd " & quoted form of projectPath & " && export PATH=" & quoted form of nodeDir & ":\$PATH" & ¬
		" && mkdir -p dist" & ¬
		" && if [ ! -f .next/BUILD_ID ] || [ -n \"\$(find app components lib next.config.ts package.json -newer .next/BUILD_ID -print -quit)\" ]; then npm run build > dist/launcher.log 2>&1; fi" & ¬
		" && (nohup npx next start --hostname 127.0.0.1 --port " & portNumber & " >> dist/launcher.log 2>&1 & echo \$!)"
	set serverPid to do shell script shellCommand
end startServer

on run
	if not isUp() then
		try
			startServer()
		on error problem
			display alert "Browser Launcher couldn't start" message problem & return & return & "See dist/launcher.log in the project folder."
			quit
			return
		end try
		repeat 120 times
			if isUp() then exit repeat
			delay 0.5
		end repeat
	end if
	open location pageAddress()
end run

-- Clicking the Dock icon again brings the page back.
on reopen
	open location pageAddress()
end reopen

on quit
	if serverPid is not "" then
		try
			do shell script "kill " & serverPid
		end try
	end if
	continue quit
end quit
APPLESCRIPT

mkdir -p "$(dirname "$OUT")"
rm -rf "$OUT"
# -s: a stay-open app, so it has a Dock icon to quit it by.
/usr/bin/osacompile -s -o "$OUT" "$SOURCE"

echo "Built: $OUT"
echo "Double-click it to start. The first time you use each feature, macOS"
echo "asks to let \"Browser Launcher\" control your browsers, and it needs"
echo "Accessibility and Screen Recording switched on for it in System Settings,"
echo "the same as your terminal did."
