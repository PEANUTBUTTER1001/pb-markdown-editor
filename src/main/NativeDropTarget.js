const { spawn } = require('child_process');

// Only hit testing; no input injection or desktop/registry changes. Run hidden.
const script = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PBHit {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
}
'@
$point = New-Object PBHit+POINT
[void][PBHit]::GetCursorPos([ref]$point)
$hit = [PBHit]::WindowFromPoint($point)
$root = [PBHit]::GetAncestor($hit, 2)
$name = New-Object System.Text.StringBuilder 256
[void][PBHit]::GetClassName($root, $name, 256)
@{ handle=$root.ToInt64().ToString(); desktop=($name.ToString() -eq 'Progman' -or $name.ToString() -eq 'WorkerW'); x=$point.X; y=$point.Y } | ConvertTo-Json -Compress
`;
function hitTest(point) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise(resolve => {
    // Capture the release point before starting PowerShell; cursor movement during compilation must not alter the drop.
    const query = point ? script.replace('[void][PBHit]::GetCursorPos([ref]$point)', '$point.X = ' + Math.round(point.x) + '\n$point.Y = ' + Math.round(point.y)) : script;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true });
    let output = '', settled = false;
    const done = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { child.kill(); done(null); }, 5000);
    child.stdout.on('data', data => { output += data; });
    child.on('error', () => done(null));
    child.on('close', code => { try { done(code === 0 ? JSON.parse(output.trim()) : null); } catch { done(null); } });
  });
}
module.exports = { hitTest };
