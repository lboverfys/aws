@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo ============================================
echo   Native Messaging Host 安装脚本
echo ============================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js 版本: %NODE_VER%

:: 获取当前目录
set "HOST_DIR=%~dp0"
set "HOST_DIR=%HOST_DIR:~0,-1%"

:: 检查 host.js
if not exist "%HOST_DIR%\host.js" (
    echo [错误] 找不到 host.js
    pause
    exit /b 1
)
echo [OK] host.js 已找到

:: 检查 xray-core
if exist "%HOST_DIR%\xray\xray.exe" (
    echo [OK] xray-core 已找到
) else (
    echo [警告] 未找到 xray-core
    echo 请下载 xray-core 并放置到: %HOST_DIR%\xray\xray.exe
    echo 下载地址: https://github.com/XTLS/Xray-core/releases
    echo.
)

:: 生成 run-host.bat
set "RUN_BAT=%HOST_DIR%\run-host.bat"
(
    echo @echo off
    echo node "%HOST_DIR%\host.js"
) > "%RUN_BAT%"
echo [OK] 已生成 run-host.bat

:: 获取扩展 ID
echo.
set /p EXT_ID="请输入 Chrome 扩展 ID (从 chrome://extensions 复制): "

if "%EXT_ID%"=="" (
    echo [错误] 扩展 ID 不能为空
    pause
    exit /b 1
)

:: 生成 manifest JSON
set "MANIFEST_PATH=%HOST_DIR%\com.aws.ext.xray.json"
set "RUN_BAT_ESCAPED=%RUN_BAT:\=\\%"

(
    echo {
    echo   "name": "com.aws.ext.xray",
    echo   "description": "AWS Auto Registration - Xray Proxy Manager",
    echo   "path": "%RUN_BAT_ESCAPED%",
    echo   "type": "stdio",
    echo   "allowed_origins": [
    echo     "chrome-extension://%EXT_ID%/"
    echo   ]
    echo }
) > "%MANIFEST_PATH%"
echo [OK] 已生成 manifest: %MANIFEST_PATH%

:: 注册到 Windows 注册表
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.aws.ext.xray" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] 已注册到 Chrome Native Messaging
) else (
    echo [错误] 注册表写入失败
    pause
    exit /b 1
)

echo.
echo ============================================
echo   安装完成！
echo ============================================
echo.
echo 后续步骤:
if not exist "%HOST_DIR%\xray\xray.exe" (
    echo 1. 下载 xray-core 到: %HOST_DIR%\xray\xray.exe
    echo 2. 重新加载 Chrome 扩展
    echo 3. 在扩展中选择「订阅」代理模式
) else (
    echo 1. 重新加载 Chrome 扩展
    echo 2. 在扩展中选择「订阅」代理模式
)
echo.
pause
