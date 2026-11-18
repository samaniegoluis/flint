// Runs flint.exe as a caller the running app has not seen (windows/serve-e2e.sh): the
// chain is flint ← cscript, and cscript is not a transparent program, so a grant given
// to "flint, started by wsl" does not cover it. The Windows stand-in for the perl
// wrapper in scripts/serve-e2e.sh.
//
//   cscript //nologo //E:jscript new-caller.js <flint.exe> <args...>
var sh = new ActiveXObject('WScript.Shell');
var a = WScript.Arguments, parts = [];
for (var i = 0; i < a.length; i++) parts.push('"' + a(i).replace(/"/g, '\\"') + '"');
var p = sh.Exec(parts.join(' '));
p.StdIn.Close();
var out = '', err = '';
while (p.Status === 0 || !p.StdOut.AtEndOfStream || !p.StdErr.AtEndOfStream) {
  if (!p.StdOut.AtEndOfStream) out += p.StdOut.ReadAll();
  if (!p.StdErr.AtEndOfStream) err += p.StdErr.ReadAll();
  if (p.Status !== 0 && p.StdOut.AtEndOfStream && p.StdErr.AtEndOfStream) break;
  WScript.Sleep(20);
}
WScript.StdOut.Write(out);
WScript.StdErr.Write(err);
WScript.Quit(p.ExitCode);
