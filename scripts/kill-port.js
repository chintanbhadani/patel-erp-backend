import fs from "fs";
import { execSync } from "child_process";

let envPort;
try {
  const envFile = fs.readFileSync(".env", "utf8");
  const match = envFile.match(/^PORT=(\d+)/m);
  if (match) {
    envPort = parseInt(match[1], 10);
  }
} catch (e) {}

const port = process.argv[2] || envPort || process.env.PORT || 8000;

console.log(`Attempting to kill process on port ${port}...`);

try {
  if (process.platform === "win32") {
    // Windows: Use Get-NetTCPConnection to find the PID and Stop-Process to kill it
    const command = `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }"`;
    execSync(command);
  } else {
    // macOS/Linux: Use lsof to find the PID and kill to end it
    const command = `lsof -ti:${port} | xargs kill -9`;
    execSync(command);
  }
  console.log(`Port ${port} has been cleared.`);
} catch (error) {
  // If no process is found, execSync might throw an error.
  // We can ignore it if it's just "command failed" because no process was listening.
  console.log(`Port ${port} is already free or no process was found.`);
}
