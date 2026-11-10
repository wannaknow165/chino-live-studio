Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
d = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = d
sh.Run "cmd /c ""C:\Program Files\nodejs\node.exe"" server.mjs > data\server.log 2>&1", 0, False
WScript.Sleep 2000
sh.Run "http://localhost:7777/", 1, False
