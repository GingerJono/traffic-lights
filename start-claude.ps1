Set-Location "C:\automation\TrafficLights"
$p = if (Test-Path ".kickoff.txt") { Get-Content -Raw ".kickoff.txt" } else { "Read CLAUDE.md, HANDOVER.md and TODO.md, summarise where things stand, and wait for instructions." }
Remove-Item ".kickoff.txt" -ErrorAction SilentlyContinue
# One follow-up message makes the new session show up in Remote Control
Start-Process powershell -WindowStyle Hidden -ArgumentList '-ExecutionPolicy','Bypass','-File',"C:\automation\ClaudeControl\nudge.ps1",'-TargetPid',$PID
claude --permission-mode auto --remote-control "traffic lights" $p