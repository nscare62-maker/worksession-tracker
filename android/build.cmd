@echo off
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
if exist "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot" (
    set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"
) else (
    set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
)
echo JAVA_HOME=%JAVA_HOME%
echo ANDROID_HOME=%ANDROID_HOME%
echo.
echo === Building Release and Debug APKs ===
call gradlew.bat assembleRelease assembleDebug
echo.
echo BUILD_EXIT=%errorlevel%
if %errorlevel%==0 (
  echo.
  echo === APKs built successfully ===
  echo Signed Release APK: app\build\outputs\apk\release\app-release.apk
  echo Debug APK:          app\build\outputs\apk\debug\app-debug.apk
) else (
  echo BUILD FAILED
)

