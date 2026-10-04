@echo off
rem 本项目是 Chrome 浏览器扩展（manifest v3），没有 exe 可执行文件。
echo 正在打开浏览器扩展管理页...
start "" chrome "chrome://extensions/" 2>nul || start "" msedge "edge://extensions/" 2>nul
echo.
echo 请开启页面右上角"开发者模式"，点击"加载已解压的扩展程序"，
echo 然后选择本项目下的 dist 文件夹。
pause
