using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace NexusAIMaster;

public sealed class MainForm : Form
{
    private const string Host = "servidor-nexus.diamantehinode2015.workers.dev";
    private const string BaseUrl = "https://" + Host;
    private const string MasterAccessUrl = BaseUrl + "/api/master/access";
    private const string MasterConsoleUrl = BaseUrl + "/api/master/console";

    private readonly WebView2 webView = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly Panel loginPanel = new()
    {
        Dock = DockStyle.Fill,
        BackColor = Color.FromArgb(5, 10, 16)
    };

    private readonly TextBox usernameBox = new()
    {
        Width = 360,
        PlaceholderText = "Usuário",
        Font = new Font("Segoe UI", 12F)
    };

    private readonly TextBox passwordBox = new()
    {
        Width = 360,
        PlaceholderText = "Senha",
        UseSystemPasswordChar = true,
        Font = new Font("Segoe UI", 12F)
    };

    private readonly CheckBox savePasswordCheck = new()
    {
        Text = "Salvar senha neste computador",
        AutoSize = true,
        ForeColor = Color.Gainsboro,
        Font = new Font("Segoe UI", 10F)
    };

    private readonly Button loginButton = new()
    {
        Text = "Entrar no MASTER",
        Width = 360,
        Height = 44,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.FromArgb(0, 135, 190),
        ForeColor = Color.White,
        Font = new Font("Segoe UI Semibold", 11F)
    };

    private readonly Label statusLabel = new()
    {
        AutoSize = false,
        Width = 440,
        Height = 48,
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.FromArgb(255, 160, 160),
        Font = new Font("Segoe UI", 9.5F)
    };

    private readonly string credentialPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NEXUS AI Master",
        "master-login.dat"
    );

    public MainForm()
    {
        Text = "NEXUS AI MASTER";
        Width = 1440;
        Height = 900;
        MinimumSize = new Size(1024, 700);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(2, 5, 8);

        Controls.Add(webView);
        Controls.Add(loginPanel);
        BuildLoginUi();

        Shown += async (_, _) =>
        {
            await InitializeWebViewAsync();
            LoadSavedCredentials();
            ShowLogin();
        };
    }

    private void BuildLoginUi()
    {
        var card = new Panel
        {
            Width = 500,
            Height = 410,
            BackColor = Color.FromArgb(9, 18, 28),
            BorderStyle = BorderStyle.FixedSingle
        };

        var title = new Label
        {
            Text = "NEXUS AI",
            ForeColor = Color.FromArgb(85, 211, 255),
            Font = new Font("Segoe UI Semibold", 24F),
            AutoSize = true
        };

        var subtitle = new Label
        {
            Text = "PAINEL MASTER",
            ForeColor = Color.WhiteSmoke,
            Font = new Font("Segoe UI Semibold", 12F),
            AutoSize = true
        };

        var hint = new Label
        {
            Text = "Acesso exclusivo do administrador",
            ForeColor = Color.Silver,
            Font = new Font("Segoe UI", 9.5F),
            AutoSize = true
        };

        title.Location = new Point(170, 42);
        subtitle.Location = new Point(184, 92);
        hint.Location = new Point(145, 122);
        usernameBox.Location = new Point(70, 165);
        usernameBox.Height = 38;
        passwordBox.Location = new Point(70, 215);
        passwordBox.Height = 38;
        savePasswordCheck.Location = new Point(70, 267);
        loginButton.Location = new Point(70, 305);
        statusLabel.Location = new Point(30, 352);

        loginButton.FlatAppearance.BorderSize = 0;
        loginButton.Click += async (_, _) => await LoginAsync();
        passwordBox.KeyDown += async (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                await LoginAsync();
            }
        };

        card.Controls.Add(title);
        card.Controls.Add(subtitle);
        card.Controls.Add(hint);
        card.Controls.Add(usernameBox);
        card.Controls.Add(passwordBox);
        card.Controls.Add(savePasswordCheck);
        card.Controls.Add(loginButton);
        card.Controls.Add(statusLabel);

        loginPanel.Controls.Add(card);
        loginPanel.Resize += (_, _) =>
        {
            card.Left = Math.Max(0, (loginPanel.ClientSize.Width - card.Width) / 2);
            card.Top = Math.Max(0, (loginPanel.ClientSize.Height - card.Height) / 2);
        };

        card.Left = Math.Max(0, (loginPanel.ClientSize.Width - card.Width) / 2);
        card.Top = Math.Max(0, (loginPanel.ClientSize.Height - card.Height) / 2);
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var dataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "NEXUS AI Master Admin",
                "WebView2"
            );
            Directory.CreateDirectory(dataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await webView.EnsureCoreWebView2Async(environment);

            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;

            webView.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                try
                {
                    System.Diagnostics.Process.Start(
                        new System.Diagnostics.ProcessStartInfo(e.Uri) { UseShellExecute = true }
                    );
                }
                catch { }
            };

            webView.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;

                var path = uri.AbsolutePath.ToLowerInvariant();
                if (path == "/login" || path == "/portal.html" || path.StartsWith("/api/portal/"))
                {
                    e.Cancel = true;
                    BeginInvoke((Action)ShowLogin);
                    return;
                }

                if (path == "/api/master/access" && webView.Visible)
                {
                    e.Cancel = true;
                    BeginInvoke((Action)ShowLogin);
                    return;
                }

                if (uri.Host.EndsWith("workers.dev", StringComparison.OrdinalIgnoreCase)) return;

                e.Cancel = true;
                try
                {
                    System.Diagnostics.Process.Start(
                        new System.Diagnostics.ProcessStartInfo(e.Uri) { UseShellExecute = true }
                    );
                }
                catch { }
            };
        }
        catch (Exception ex)
        {
            statusLabel.Text = "Falha ao iniciar o navegador interno: " + ex.Message;
        }
    }

    private async Task LoginAsync()
    {
        var username = usernameBox.Text.Trim();
        var password = passwordBox.Text;

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
        {
            statusLabel.Text = "Informe o usuário e a senha.";
            return;
        }

        loginButton.Enabled = false;
        loginButton.Text = "Entrando...";
        statusLabel.Text = "";

        try
        {
            var cookies = new CookieContainer();
            using var handler = new HttpClientHandler
            {
                AllowAutoRedirect = false,
                UseCookies = true,
                CookieContainer = cookies
            };
            using var http = new HttpClient(handler)
            {
                Timeout = TimeSpan.FromSeconds(20)
            };

            using var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["username"] = username,
                ["password"] = password
            });

            using var response = await http.PostAsync(MasterAccessUrl, content);

            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                statusLabel.Text = "Usuário ou senha inválidos.";
                passwordBox.SelectAll();
                passwordBox.Focus();
                return;
            }

            if (response.StatusCode != HttpStatusCode.SeeOther
                && response.StatusCode != HttpStatusCode.Found
                && response.StatusCode != HttpStatusCode.Redirect)
            {
                statusLabel.Text = "O servidor recusou o acesso. Código: " + (int)response.StatusCode;
                return;
            }

            var sessionCookie = cookies.GetCookies(new Uri(BaseUrl))["nexus_master"];
            if (sessionCookie is null || string.IsNullOrWhiteSpace(sessionCookie.Value))
            {
                statusLabel.Text = "O servidor não devolveu a sessão do MASTER.";
                return;
            }

            if (webView.CoreWebView2 is null)
            {
                statusLabel.Text = "O navegador interno ainda não terminou de carregar.";
                return;
            }

            var webCookie = webView.CoreWebView2.CookieManager.CreateCookie(
                "nexus_master",
                sessionCookie.Value,
                Host,
                "/"
            );
            webCookie.IsHttpOnly = true;
            webCookie.IsSecure = true;
            webView.CoreWebView2.CookieManager.AddOrUpdateCookie(webCookie);

            if (savePasswordCheck.Checked)
            {
                SaveCredentials(username, password);
            }
            else
            {
                DeleteSavedCredentials();
            }

            loginPanel.Visible = false;
            webView.Visible = true;
            webView.BringToFront();
            webView.CoreWebView2.Navigate(MasterConsoleUrl);
        }
        catch (TaskCanceledException)
        {
            statusLabel.Text = "Tempo de conexão esgotado. Tente novamente.";
        }
        catch (Exception ex)
        {
            statusLabel.Text = "Falha no acesso: " + ex.Message;
        }
        finally
        {
            loginButton.Enabled = true;
            loginButton.Text = "Entrar no MASTER";
        }
    }

    private void ShowLogin()
    {
        webView.Visible = false;
        loginPanel.Visible = true;
        loginPanel.BringToFront();
        statusLabel.Text = "";
        usernameBox.Focus();
    }

    private void SaveCredentials(string username, string password)
    {
        try
        {
            var directory = Path.GetDirectoryName(credentialPath);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var payload = username + "\n" + password;
            var plain = Encoding.UTF8.GetBytes(payload);
            var protectedBytes = ProtectedData.Protect(
                plain,
                null,
                DataProtectionScope.CurrentUser
            );
            File.WriteAllBytes(credentialPath, protectedBytes);
        }
        catch
        {
            // O login continua funcionando mesmo se o Windows bloquear a gravação local.
        }
    }

    private void LoadSavedCredentials()
    {
        try
        {
            if (!File.Exists(credentialPath)) return;

            var protectedBytes = File.ReadAllBytes(credentialPath);
            var plain = ProtectedData.Unprotect(
                protectedBytes,
                null,
                DataProtectionScope.CurrentUser
            );
            var payload = Encoding.UTF8.GetString(plain);
            var separator = payload.IndexOf('\n');
            if (separator <= 0) return;

            usernameBox.Text = payload[..separator];
            passwordBox.Text = payload[(separator + 1)..];
            savePasswordCheck.Checked = true;
        }
        catch
        {
            DeleteSavedCredentials();
        }
    }

    private void DeleteSavedCredentials()
    {
        try
        {
            if (File.Exists(credentialPath))
            {
                File.Delete(credentialPath);
            }
        }
        catch { }
    }
}
