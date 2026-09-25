using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Net.Http;

namespace NexusAI;

public sealed class MainForm : Form
{
    private const string NexusUrl = "https://servidor-nexus.diamantehinode2015.workers.dev/login";

    private static readonly string[] AllowedHosts =
    {
        "workers.dev",
        "instagram.com",
        "facebook.com",
        "fbcdn.net",
        "painel.ragnarplay.online"
    };
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };

    public MainForm()
    {
        Text = "NEXUS AI";
        Width = 1360;
        Height = 860;
        MinimumSize = new Size(960, 640);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(2, 5, 8);
        Controls.Add(webView);
        Shown += async (_, _) => await StartNexusAsync();
    }

    private async Task StartNexusAsync()
    {
        try
        {
            var dataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "NEXUS AI",
                "WebView2"
            );
            Directory.CreateDirectory(dataFolder);

            var runtimeReady = await WebView2Runtime.EnsureInstalledAsync(this);
            if (!runtimeReady)
            {
                MessageBox.Show(
                    "O NEXUS AI precisa do Microsoft Edge WebView2 Runtime e não foi possível instalá-lo automaticamente.\n\nBaixe manualmente em:\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703",
                    "NEXUS AI - Componente necessário",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                Close();
                return;
            }

            var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await webView.EnsureCoreWebView2Async(environment);

            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

            webView.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (IsAllowedHost(e.Uri))
                {
                    webView.CoreWebView2.Navigate(e.Uri);
                    return;
                }
                OpenExternal(e.Uri);
            };

            webView.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
                if (IsAllowedHost(uri)) return;

                e.Cancel = true;
                OpenExternal(e.Uri);
            };

            webView.CoreWebView2.Navigate(NexusUrl);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Não foi possível iniciar o NEXUS AI. Verifique sua conexão com a internet e tente novamente.\n\n" + ex.Message,
                "NEXUS AI",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }

    private static bool IsAllowedHost(string url)
    {
        return Uri.TryCreate(url, UriKind.Absolute, out var uri) && IsAllowedHost(uri);
    }

    private static bool IsAllowedHost(Uri uri)
    {
        foreach (var allowed in AllowedHosts)
        {
            if (uri.Host.Equals(allowed, StringComparison.OrdinalIgnoreCase)) return true;
            if (uri.Host.EndsWith("." + allowed, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static void OpenExternal(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch { }
    }

}


internal static class WebView2Runtime
{
    private const string BootstrapperUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    public static async Task<bool> EnsureInstalledAsync(Form owner)
    {
        if (IsInstalled()) return true;

        var proceed = MessageBox.Show(
            owner,
            "O NEXUS AI precisa instalar um componente da Microsoft (WebView2 Runtime) na primeira vez que roda neste computador. Isso acontece uma única vez.\n\nDeseja instalar agora?",
            "NEXUS AI - Instalação necessária",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Information
        );
        if (proceed != DialogResult.Yes) return false;

        try
        {
            var installerPath = Path.Combine(Path.GetTempPath(), "MicrosoftEdgeWebView2Setup.exe");
            using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) })
            using (var stream = await http.GetStreamAsync(BootstrapperUrl))
            using (var file = File.Create(installerPath))
            {
                await stream.CopyToAsync(file);
            }

            var startInfo = new ProcessStartInfo(installerPath)
            {
                Arguments = "/silent /install",
                UseShellExecute = true,
                Verb = "runas"
            };

            using var process = Process.Start(startInfo);
            if (process != null) await process.WaitForExitAsync();
            return IsInstalled();
        }
        catch
        {
            return false;
        }
    }

    private static bool IsInstalled()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            return !string.IsNullOrWhiteSpace(version);
        }
        catch
        {
            return false;
        }
    }
}
