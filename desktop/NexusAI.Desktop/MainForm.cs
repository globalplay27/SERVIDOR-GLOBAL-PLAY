using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;

namespace NexusAI;

public sealed class MainForm : Form
{
    private const string NexusUrl = "https://servidor-nexus.diamantehinode2015.workers.dev/login";
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

            var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await webView.EnsureCoreWebView2Async(environment);

            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

            webView.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                try
                {
                    Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
                }
                catch { }
            };

            webView.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
                if (uri.Host.EndsWith("workers.dev", StringComparison.OrdinalIgnoreCase)) return;
                if (uri.Host.Equals("painel.ragnarplay.online", StringComparison.OrdinalIgnoreCase)) return;

                e.Cancel = true;
                try
                {
                    Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
                }
                catch { }
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
}
