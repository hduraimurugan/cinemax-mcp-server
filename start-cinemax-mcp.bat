@echo off
REM Cinemax MCP Server Launcher for Claude Desktop
REM This wrapper guarantees env vars are set correctly regardless of CWD.

set "CINEMAX_MCP_API_KEY=cmax_353a734da3a043081c5fbb904fbf2d119e8d6aa20600cbda53a71bd62bc69ea8"
set "DATABASE_URL=postgresql://cinemax_reader:Durai1234@localhost:5432/cinema_hall_db"
set "API_BASE_URL=http://localhost:5000"
set "LOG_LEVEL=info"

"C:\Program Files\nodejs\node.exe" "D:\Users\Duraimurugan H\Git Cloned\My Projects\cinema-hall\cinemax-mcp-server\src\server.js"
