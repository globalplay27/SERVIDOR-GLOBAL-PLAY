#define MyAppName "NEXUS AI"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "NEXUS AI"
#define MyAppExeName "NexusAI.exe"

[Setup]
AppId={{B8C2BA01-4E87-4D08-8A8C-7D1B1E90D6D2}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\NEXUS AI
DefaultGroupName=NEXUS AI
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=NEXUS-AI-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\NEXUS AI"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\NEXUS AI"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir NEXUS AI"; Flags: nowait postinstall skipifsilent
