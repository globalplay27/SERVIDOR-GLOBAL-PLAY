#define MyAppName "NEXUS AI MASTER"
#define MyAppVersion "1.5.0"
#define MyAppPublisher "NEXUS AI"
#define MyAppExeName "NexusAIMaster15.exe"

[Setup]
AppId={{7C573B30-4DA1-42E7-B8C7-3C2B775772A6}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\NEXUS AI MASTER
DefaultGroupName=NEXUS AI MASTER
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=NEXUS-AI-MASTER-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\NEXUS AI MASTER"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\NEXUS AI MASTER"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir NEXUS AI MASTER"; Flags: nowait postinstall skipifsilent

[InstallDelete]
Type: files; Name: "{app}\NexusAIMaster.exe"
