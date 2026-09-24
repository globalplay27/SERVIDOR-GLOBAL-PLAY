using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;

namespace NexusAIMaster;

public sealed class MainForm : Form
{
    private const string NexusMasterUrl = "https://servidor-nexus.diamanteRinode2015.workers.dev/master";
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };

    public MainForm()
    {
        Text = "NEXUS AI MASTER";
        Width = 1440;
        Height = 900;
        MinimumSize = new Size(1024, 700);
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
                "NEXUS AI Master",
                "WebView2"
            );
            Directory.CreateDirectory(dataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await webView.EnsureCoreWebView2Async(environment);

            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;

            webView.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
            };

            webView.CoreWebView2.Navigate(NexusMasterUrl);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Não foi possível iniciar o NEXUS AI Master. Verifique sua conexão com a internet e tente novamente.\n\n" + ex.Message,
                "NEXUS AI MASTER",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}