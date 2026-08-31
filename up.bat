```bat
@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title GitHub Upload - Projeto Figma
color 0A

set "REPO=https://github.com/Alissonxl/Projeto-figma.git"
set "BRANCH=main"

echo ================================================
echo              GITHUB UPLOAD AUTOMATICO
echo ================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
    color 0C
    echo [ERRO] Git nao encontrado no computador.
    echo.
    echo Instale o Git e tente novamente.
    pause
    exit /b 1
)

if not exist ".git" (
    echo [INFO] Inicializando repositorio Git...
    git init
    if errorlevel 1 goto erro
)

git config user.name >nul 2>&1
if errorlevel 1 (
    echo.
    set /p gitname="Nome para os commits: "
    if "!gitname!"=="" set "gitname=Alissonxl"
    git config user.name "!gitname!"
)

git config user.email >nul 2>&1
if errorlevel 1 (
    echo.
    set /p gitemail="Email do GitHub: "
    if "!gitemail!"=="" (
        echo [ERRO] O email nao pode ficar vazio.
        pause
        exit /b 1
    )
    git config user.email "!gitemail!"
)

git remote get-url origin >nul 2>&1

if errorlevel 1 (
    echo [INFO] Configurando repositorio remoto...
    git remote add origin "%REPO%"
) else (
    for /f "delims=" %%i in ('git remote get-url origin') do set "ORIGIN=%%i"

    if /I not "!ORIGIN!"=="%REPO%" (
        echo [INFO] Atualizando URL do repositorio...
        git remote set-url origin "%REPO%"
    )
)

if not exist ".gitignore" (
    echo [INFO] Criando .gitignore...
    (
        echo node_modules/
        echo dist/
        echo build/
        echo coverage/
        echo .cache/
        echo .vite/
        echo .next/
        echo out/
        echo.
        echo .env
        echo .env.local
        echo .env.development.local
        echo .env.test.local
        echo .env.production.local
        echo .env.*
        echo !.env.example
        echo.
        echo *.log
        echo npm-debug.log*
        echo yarn-debug.log*
        echo yarn-error.log*
        echo pnpm-debug.log*
        echo.
        echo .DS_Store
        echo Thumbs.db
        echo desktop.ini
        echo.
        echo .idea/
    ) > .gitignore
)

echo.
echo ================================================
echo                    STATUS
echo ================================================
echo.

git status --short

echo.
set /p mensagem="Mensagem do commit: "

if "!mensagem!"=="" (
    set "mensagem=Atualizacao do projeto"
)

echo.
echo ================================================
echo                 PREPARANDO ENVIO
echo ================================================
echo.

echo [1/6] Adicionando arquivos...
git add .
if errorlevel 1 goto erro

git diff --cached --quiet

if not errorlevel 1 (
    echo.
    echo [INFO] Nenhuma alteracao nova encontrada.
    echo [INFO] Verificando sincronizacao com GitHub...
    goto sincronizar
)

echo [2/6] Criando commit...
git commit -m "!mensagem!"
if errorlevel 1 goto erro

echo [3/6] Configurando branch "%BRANCH%"...
git branch -M %BRANCH%
if errorlevel 1 goto erro

:sincronizar
echo [4/6] Verificando repositorio remoto...

git ls-remote --exit-code origin %BRANCH% >nul 2>&1

if errorlevel 1 (
    echo [INFO] Branch remota ainda nao existe.
    goto enviar
)

echo [5/6] Sincronizando com GitHub...
git pull origin %BRANCH% --rebase

if errorlevel 1 (
    color 0E
    echo.
    echo ================================================
    echo             CONFLITO ENCONTRADO
    echo ================================================
    echo.
    echo O Git encontrou arquivos conflitantes.
    echo Resolva os conflitos e execute este .bat novamente.
    echo.
    echo Para cancelar o rebase:
    echo git rebase --abort
    echo.
    pause
    exit /b 1
)

:enviar
echo [6/6] Enviando arquivos para GitHub...
git push -u origin %BRANCH%

if errorlevel 1 goto erro

color 0A

echo.
echo ================================================
echo             UPLOAD CONCLUIDO
echo ================================================
echo.
echo Repositorio:
echo %REPO%
echo.
echo Branch:
echo %BRANCH%
echo.
echo Commit:
echo !mensagem!
echo.

git log -1 --pretty=format:"Hash: %%h%nData: %%cd%nAutor: %%an%nMensagem: %%s" --date=format:"%%d/%%m/%%Y %%H:%%M"

echo.
echo.
echo ================================================
pause
exit /b 0


:erro
color 0C
echo.
echo ================================================
echo                OCORREU UM ERRO
echo ================================================
echo.
echo Verifique a mensagem exibida acima.
echo.
echo Repositorio configurado:
echo %REPO%
echo.
pause
exit /b 1
```
