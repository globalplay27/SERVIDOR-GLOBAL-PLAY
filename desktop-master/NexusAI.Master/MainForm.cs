using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Drawing.Drawing2D;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace NexusAIMaster;

public sealed class MainForm : Form
{
    private const string Host = "servidor-nexus.diamantehinode2015.workers.dev";
    private const string BaseUrl = "https://" + Host;
    private const string MasterAccessUrl = BaseUrl + "/api/master/access";

    private readonly WebView2 webView = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly NexusBackdropPanel loginPanel = new() { Dock = DockStyle.Fill };

    private readonly Panel heroPanel = new()
    {
        BackColor = Color.Transparent
    };

    private readonly RoundedPanel loginCard = new()
    {
        BackColor = Color.FromArgb(12, 21, 31),
        Radius = 28
    };

    private readonly PictureBox logo = new()
    {
        SizeMode = PictureBoxSizeMode.Zoom,
        BackColor = Color.Transparent
    };

    private readonly TextBox usernameBox = new()
    {
        BorderStyle = BorderStyle.FixedSingle,
        BackColor = Color.FromArgb(6, 13, 20),
        ForeColor = Color.White,
        Font = new Font("Segoe UI", 12F),
        Width = 390,
        Height = 38
    };

    private readonly TextBox passwordBox = new()
    {
        BorderStyle = BorderStyle.FixedSingle,
        BackColor = Color.FromArgb(6, 13, 20),
        ForeColor = Color.White,
        Font = new Font("Segoe UI", 12F),
        Width = 390,
        Height = 38,
        UseSystemPasswordChar = true
    };

    private readonly CheckBox savePasswordCheck = new()
    {
        Text = "Salvar senha",
        Appearance = Appearance.Button,
        AutoSize = false,
        Width = 168,
        Height = 36,
        TextAlign = ContentAlignment.MiddleCenter,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.FromArgb(18, 31, 43),
        ForeColor = Color.Gainsboro,
        Font = new Font("Segoe UI Semibold", 9.5F),
        Cursor = Cursors.Hand
    };

    private readonly Button loginButton = new()
    {
        Text = "ENTRAR NO MASTER",
        Width = 390,
        Height = 48,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.FromArgb(45, 199, 245),
        ForeColor = Color.FromArgb(1, 12, 20),
        Font = new Font("Segoe UI Semibold", 11F),
        Cursor = Cursors.Hand
    };

    private readonly Label statusLabel = new()
    {
        AutoSize = false,
        Width = 390,
        Height = 54,
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.FromArgb(255, 135, 145),
        Font = new Font("Segoe UI", 9.5F)
    };

    private readonly string credentialPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NEXUS AI Master",
        "master-login.dat"
    );

    private bool authSubmitting;
    private bool formSubmitted;
    private string pendingUsername = "";
    private string pendingPassword = "";

    public MainForm()
    {
        Text = "NEXUS AI MASTER";
        Width = 1440;
        Height = 900;
        MinimumSize = new Size(1024, 700);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(2, 5, 8);
        Font = new Font("Segoe UI", 10F);

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
        loginPanel.Controls.Add(heroPanel);
        loginPanel.Controls.Add(loginCard);

        var heroKicker = new Label
        {
            Text = "NEXUS AI · CENTRAL DE COMANDO",
            ForeColor = Color.FromArgb(94, 214, 255),
            Font = new Font("Segoe UI Semibold", 10F),
            AutoSize = true,
            BackColor = Color.Transparent
        };

        var heroTitle = new Label
        {
            Text = "Controle total.\nUma única central.",
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 31F),
            AutoSize = true,
            BackColor = Color.Transparent
        };

        var heroBody = new Label
        {
            Text = "Gerencie clientes, agentes, postagens, integrações e automações do NEXUS AI em um ambiente administrativo exclusivo.",
            ForeColor = Color.FromArgb(155, 176, 190),
            Font = new Font("Segoe UI", 11F),
            AutoSize = false,
            Width = 530,
            Height = 88,
            BackColor = Color.Transparent
        };

        var heroLine = new Label
        {
            Text = "●  SERVIDOR NEXUS ONLINE",
            ForeColor = Color.FromArgb(93, 211, 255),
            Font = new Font("Segoe UI Semibold", 9F),
            AutoSize = true,
            BackColor = Color.Transparent
        };

        heroPanel.Controls.Add(logo);
        heroPanel.Controls.Add(heroKicker);
        heroPanel.Controls.Add(heroTitle);
        heroPanel.Controls.Add(heroBody);
        heroPanel.Controls.Add(heroLine);

        logo.Location = new Point(54, 64);
        logo.Size = new Size(260, 92);
        heroKicker.Location = new Point(58, 195);
        heroTitle.Location = new Point(54, 232);
        heroBody.Location = new Point(58, 342);
        heroLine.Location = new Point(58, 450);

        try
        {
            var logoPath = Path.Combine(AppContext.BaseDirectory, "Assets", "nexus-ai-logo.png");
            if (File.Exists(logoPath))
            {
                logo.Image = Image.FromFile(logoPath);
            }
        }
        catch { }

        var smallKicker = new Label
        {
            Text = "ACESSO ADMINISTRATIVO",
            ForeColor = Color.FromArgb(93, 211, 255),
            Font = new Font("Segoe UI Semibold", 9F),
            AutoSize = true
        };

        var title = new Label
        {
            Text = "Painel Master",
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 27F),
            AutoSize = true
        };

        var sub = new Label
        {
            Text = "Entre com sua credencial de administrador.",
            ForeColor = Color.FromArgb(145, 165, 178),
            Font = new Font("Segoe UI", 10F),
            AutoSize = true
        };

        var userLabel = new Label
        {
            Text = "USUÁRIO",
            ForeColor = Color.FromArgb(155, 178, 192),
            Font = new Font("Segoe UI Semibold", 9F),
            AutoSize = true
        };

        var passLabel = new Label
        {
            Text = "SENHA",
            ForeColor = Color.FromArgb(155, 178, 192),
            Font = new Font("Segoe UI Semibold", 9F),
            AutoSize = true
        };

        var secure = new Label
        {
            Text = "Protegido por sessão administrativa NEXUS · Cloudflare",
            ForeColor = Color.FromArgb(91, 112, 126),
            Font = new Font("Segoe UI", 8.5F),
            AutoSize = true
        };

        smallKicker.Location = new Point(52, 48);
        title.Location = new Point(48, 76);
        sub.Location = new Point(52, 126);

        userLabel.Location = new Point(52, 178);
        usernameBox.Location = new Point(52, 202);

        passLabel.Location = new Point(52, 260);
        passwordBox.Location = new Point(52, 284);

        savePasswordCheck.Location = new Point(52, 342);
        loginButton.Location = new Point(52, 396);
        statusLabel.Location = new Point(52, 452);
        secure.Location = new Point(52, 514);

        usernameBox.PlaceholderText = "Digite o usuário";
        passwordBox.PlaceholderText = "Digite a senha";

        savePasswordCheck.FlatAppearance.BorderColor = Color.FromArgb(47, 79, 98);
        savePasswordCheck.FlatAppearance.CheckedBackColor = Color.FromArgb(0, 88, 122);

        loginButton.FlatAppearance.BorderSize = 0;
        loginButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(83, 218, 255);
        loginButton.FlatAppearance.MouseDownBackColor = Color.FromArgb(28, 170, 215);

        loginCard.Controls.Add(smallKicker);
        loginCard.Controls.Add(title);
        loginCard.Controls.Add(sub);
        loginCard.Controls.Add(userLabel);
        loginCard.Controls.Add(usernameBox);
        loginCard.Controls.Add(passLabel);
        loginCard.Controls.Add(passwordBox);
        loginCard.Controls.Add(savePasswordCheck);
        loginCard.Controls.Add(loginButton);
        loginCard.Controls.Add(statusLabel);
        loginCard.Controls.Add(secure);

        savePasswordCheck.CheckedChanged += (_, _) =>
        {
            savePasswordCheck.Text = savePasswordCheck.Checked ? "✓  Salvar senha" : "Salvar senha";
            savePasswordCheck.ForeColor = savePasswordCheck.Checked
                ? Color.White
                : Color.Gainsboro;
        };

        loginButton.Click += async (_, _) => await StartWebViewLoginAsync();
        passwordBox.KeyDown += async (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                await StartWebViewLoginAsync();
            }
        };

        loginPanel.Resize += (_, _) => LayoutLogin();
        LayoutLogin();
    }

    private void LayoutLogin()
    {
        var width = loginPanel.ClientSize.Width;
        var height = loginPanel.ClientSize.Height;

        var heroWidth = Math.Max(470, (int)(width * 0.56));
        heroPanel.SetBounds(0, 0, heroWidth, height);

        var cardWidth = 494;
        var cardHeight = 565;
        var rightStart = heroWidth;
        var rightWidth = Math.Max(494, width - heroWidth);

        loginCard.Width = cardWidth;
        loginCard.Height = cardHeight;
        loginCard.Left = rightStart + Math.Max(0, (rightWidth - cardWidth) / 2);
        loginCard.Top = Math.Max(38, (height - cardHeight) / 2);
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
            webView.CoreWebView2.Settings.IsZoomControlEnabled = true;

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

                if ((path == "/login" || path == "/portal.html" || path.StartsWith("/api/portal/")))
                {
                    e.Cancel = true;
                    authSubmitting = false;
                    BeginInvoke((Action)(() =>
                    {
                        statusLabel.Text = "O MASTER tentou abrir uma rota de cliente e foi bloqueado.";
                        ShowLogin();
                    }));
                    return;
                }

                if (path == "/api/master/access" && !authSubmitting)
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

            webView.CoreWebView2.NavigationCompleted += async (_, e) =>
            {
                if (!authSubmitting) return;

                var source = webView.Source?.ToString() ?? "";
                if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)) return;
                var path = uri.AbsolutePath.ToLowerInvariant();

                if (path == "/api/master/access")
                {
                    if (!formSubmitted)
                    {
                        formSubmitted = true;

                        var userJson = JsonSerializer.Serialize(pendingUsername);
                        var passJson = JsonSerializer.Serialize(pendingPassword);
                        var script = $@"(() => {{
                            const u = {userJson};
                            const p = {passJson};
                            const form = document.querySelector('form');
                            const user = document.querySelector('input[name=""username""]');
                            const pass = document.querySelector('input[name=""password""]');
                            if (!form || !user || !pass) return 'missing-form';
                            user.value = u;
                            pass.value = p;
                            form.submit();
                            return 'submitted';
                        }})()";

                        try
                        {
                            var result = await webView.CoreWebView2.ExecuteScriptAsync(script);
                            if (result.Contains("missing-form", StringComparison.OrdinalIgnoreCase))
                            {
                                LoginFailed("O formulário de acesso do MASTER não foi encontrado.");
                            }
                        }
                        catch (Exception ex)
                        {
                            LoginFailed("Falha ao enviar o login: " + ex.Message);
                        }

                        return;
                    }

                    LoginFailed("Usuário ou senha inválidos.");
                    return;
                }

                if (path == "/api/master/console" || path == "/master" || path == "/master/")
                {
                    Authenticated();
                    return;
                }

                if (!e.IsSuccess && formSubmitted)
                {
                    LoginFailed("O servidor não concluiu o acesso ao MASTER.");
                }
            };
        }
        catch (Exception ex)
        {
            statusLabel.Text = "Falha ao iniciar o navegador interno: " + ex.Message;
        }
    }

    private async Task StartWebViewLoginAsync()
    {
        var username = usernameBox.Text.Trim();
        var password = passwordBox.Text;

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
        {
            statusLabel.Text = "Informe o usuário e a senha.";
            return;
        }

        if (webView.CoreWebView2 is null)
        {
            statusLabel.Text = "O núcleo do aplicativo ainda está carregando. Tente novamente em alguns segundos.";
            return;
        }

        pendingUsername = username;
        pendingPassword = password;
        authSubmitting = true;
        formSubmitted = false;

        loginButton.Enabled = false;
        loginButton.Text = "CONECTANDO...";
        statusLabel.ForeColor = Color.FromArgb(115, 204, 235);
        statusLabel.Text = "Validando acesso administrativo...";

        var target = MasterAccessUrl + "?desktop=1&v=" + Uri.EscapeDataString(Guid.NewGuid().ToString("N"));
        webView.CoreWebView2.Navigate(target);

        await Task.CompletedTask;
    }

    private void Authenticated()
    {
        if (!authSubmitting) return;

        authSubmitting = false;
        formSubmitted = false;

        if (savePasswordCheck.Checked)
        {
            SaveCredentials(pendingUsername, pendingPassword);
        }
        else
        {
            DeleteSavedCredentials();
        }

        pendingPassword = "";
        statusLabel.Text = "";
        loginButton.Enabled = true;
        loginButton.Text = "ENTRAR NO MASTER";

        loginPanel.Visible = false;
        webView.Visible = true;
        webView.BringToFront();
    }

    private void LoginFailed(string message)
    {
        authSubmitting = false;
        formSubmitted = false;
        pendingPassword = "";

        loginButton.Enabled = true;
        loginButton.Text = "ENTRAR NO MASTER";
        statusLabel.ForeColor = Color.FromArgb(255, 135, 145);
        statusLabel.Text = message;

        ShowLogin(keepStatus: true);
        passwordBox.SelectAll();
        passwordBox.Focus();
    }

    private void ShowLogin(bool keepStatus = false)
    {
        webView.Visible = false;
        loginPanel.Visible = true;
        loginPanel.BringToFront();

        if (!keepStatus)
        {
            statusLabel.Text = "";
        }

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
            // O acesso continua funcionando mesmo se o Windows bloquear a gravação local.
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

internal sealed class NexusBackdropPanel : Panel
{
    public NexusBackdropPanel()
    {
        DoubleBuffered = true;
        BackColor = Color.FromArgb(2, 6, 10);
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        var rect = ClientRectangle;
        if (rect.Width <= 0 || rect.Height <= 0) return;

        using var brush = new LinearGradientBrush(
            rect,
            Color.FromArgb(3, 9, 15),
            Color.FromArgb(2, 5, 8),
            LinearGradientMode.Horizontal
        );
        e.Graphics.FillRectangle(brush, rect);

        using var glow = new PathGradientBrush(new[]
        {
            new PointF(rect.Width * 0.18f, rect.Height * 0.18f),
            new PointF(rect.Width * 0.68f, rect.Height * 0.18f),
            new PointF(rect.Width * 0.68f, rect.Height * 0.82f),
            new PointF(rect.Width * 0.18f, rect.Height * 0.82f)
        })
        {
            CenterColor = Color.FromArgb(38, 0, 154, 214),
            SurroundColors = new[]
            {
                Color.Transparent,
                Color.Transparent,
                Color.Transparent,
                Color.Transparent
            }
        };
        e.Graphics.FillRectangle(glow, rect);

        using var gridPen = new Pen(Color.FromArgb(10, 85, 170, 210), 1);
        const int step = 42;
        for (var x = 0; x < rect.Width; x += step)
            e.Graphics.DrawLine(gridPen, x, 0, x, rect.Height);
        for (var y = 0; y < rect.Height; y += step)
            e.Graphics.DrawLine(gridPen, 0, y, rect.Width, y);
    }
}

internal sealed class RoundedPanel : Panel
{
    public int Radius { get; set; } = 24;

    protected override void OnResize(EventArgs eventargs)
    {
        base.OnResize(eventargs);
        ApplyRegion();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyRegion();
    }

    private void ApplyRegion()
    {
        if (Width <= 0 || Height <= 0) return;

        var diameter = Math.Max(2, Radius * 2);
        using var path = new GraphicsPath();

        path.AddArc(0, 0, diameter, diameter, 180, 90);
        path.AddArc(Width - diameter, 0, diameter, diameter, 270, 90);
        path.AddArc(Width - diameter, Height - diameter, diameter, diameter, 0, 90);
        path.AddArc(0, Height - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();

        Region?.Dispose();
        Region = new Region(path);
    }
}
