using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Drawing.Drawing2D;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace NexusAIMaster;

public sealed class MainForm : Form
{
    private const string Host = "servidor-nexus.diamantehinode2015.workers.dev";
    private const string BaseUrl = "https://" + Host;
    private const string DesktopLoginUrl = BaseUrl + "/api/master/desktop-login";
    private const string MasterConsoleUrl = BaseUrl + "/api/master/console";

    private readonly WebView2 webView = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly NexusBackdropPanel loginPanel = new() { Dock = DockStyle.Fill };

    private readonly RoundedPanel loginCard = new()
    {
        BackColor = Color.FromArgb(10, 18, 28),
        Radius = 30
    };

    private readonly TextBox usernameBox = new()
    {
        BorderStyle = BorderStyle.FixedSingle,
        BackColor = Color.FromArgb(4, 10, 16),
        ForeColor = Color.White,
        Font = new Font("Segoe UI", 12F),
        Width = 400,
        Height = 40,
        PlaceholderText = "Digite o usuário"
    };

    private readonly TextBox passwordBox = new()
    {
        BorderStyle = BorderStyle.FixedSingle,
        BackColor = Color.FromArgb(4, 10, 16),
        ForeColor = Color.White,
        Font = new Font("Segoe UI", 12F),
        Width = 400,
        Height = 40,
        PlaceholderText = "Digite a senha",
        UseSystemPasswordChar = true
    };

    private readonly CheckBox savePasswordCheck = new()
    {
        Text = "Salvar senha",
        Appearance = Appearance.Button,
        AutoSize = false,
        Width = 160,
        Height = 36,
        TextAlign = ContentAlignment.MiddleCenter,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.FromArgb(17, 30, 42),
        ForeColor = Color.Gainsboro,
        Font = new Font("Segoe UI Semibold", 9.5F),
        Cursor = Cursors.Hand
    };

    private readonly Button loginButton = new()
    {
        Text = "ENTRAR NO MASTER",
        Width = 400,
        Height = 50,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.FromArgb(44, 201, 244),
        ForeColor = Color.FromArgb(1, 13, 20),
        Font = new Font("Segoe UI Semibold", 11F),
        Cursor = Cursors.Hand
    };

    private readonly Label statusLabel = new()
    {
        AutoSize = false,
        Width = 400,
        Height = 56,
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.FromArgb(255, 137, 148),
        Font = new Font("Segoe UI", 9.5F)
    };

    private readonly string credentialPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NEXUS AI Master",
        "master-login.dat"
    );

    public MainForm()
    {
        Text = "NEXUS AI MASTER v1.5.0";
        Width = 1420;
        Height = 860;
        MinimumSize = new Size(1040, 700);
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
        var hero = new Panel { BackColor = Color.Transparent };
        loginPanel.Controls.Add(hero);
        loginPanel.Controls.Add(loginCard);

        var brand = new NexusBrandControl
        {
            Width = 390,
            Height = 108,
            BackColor = Color.Transparent
        };

        var kicker = NewLabel(
            "NEXUS AI · CENTRAL DE COMANDO",
            10F,
            FontStyle.Bold,
            Color.FromArgb(92, 215, 255)
        );

        var heroTitle = NewLabel(
            "Controle total.\nUma única central.",
            31F,
            FontStyle.Bold,
            Color.White
        );

        var heroBody = new Label
        {
            Text = "Gerencie clientes, agentes, postagens, integrações e automações em um ambiente administrativo exclusivo.",
            ForeColor = Color.FromArgb(155, 176, 190),
            Font = new Font("Segoe UI", 11F),
            AutoSize = false,
            Width = 540,
            Height = 80,
            BackColor = Color.Transparent
        };

        var server = NewLabel(
            "●  SERVIDOR NEXUS ONLINE",
            9F,
            FontStyle.Bold,
            Color.FromArgb(92, 215, 255)
        );

        brand.Location = new Point(55, 62);
        kicker.Location = new Point(62, 195);
        heroTitle.Location = new Point(56, 235);
        heroBody.Location = new Point(60, 350);
        server.Location = new Point(60, 448);

        hero.Controls.Add(brand);
        hero.Controls.Add(kicker);
        hero.Controls.Add(heroTitle);
        hero.Controls.Add(heroBody);
        hero.Controls.Add(server);

        var smallKicker = NewLabel(
            "ACESSO ADMINISTRATIVO",
            9F,
            FontStyle.Bold,
            Color.FromArgb(92, 215, 255)
        );

        var title = NewLabel(
            "Painel Master",
            28F,
            FontStyle.Bold,
            Color.White
        );

        var sub = NewLabel(
            "Entre com sua credencial de administrador.",
            10F,
            FontStyle.Regular,
            Color.FromArgb(147, 167, 180)
        );

        var userLabel = NewLabel(
            "USUÁRIO",
            8.5F,
            FontStyle.Bold,
            Color.FromArgb(150, 176, 191)
        );

        var passLabel = NewLabel(
            "SENHA",
            8.5F,
            FontStyle.Bold,
            Color.FromArgb(150, 176, 191)
        );

        var secure = NewLabel(
            "NEXUS AI MASTER v1.5.0 · sessão protegida · Cloudflare",
            8.5F,
            FontStyle.Regular,
            Color.FromArgb(84, 111, 128)
        );

        smallKicker.Location = new Point(48, 48);
        title.Location = new Point(46, 78);
        sub.Location = new Point(50, 132);

        userLabel.Location = new Point(50, 188);
        usernameBox.Location = new Point(50, 214);

        passLabel.Location = new Point(50, 276);
        passwordBox.Location = new Point(50, 302);

        savePasswordCheck.Location = new Point(50, 365);
        loginButton.Location = new Point(50, 418);
        statusLabel.Location = new Point(50, 476);
        secure.Location = new Point(50, 535);

        savePasswordCheck.FlatAppearance.BorderColor = Color.FromArgb(43, 78, 98);
        savePasswordCheck.FlatAppearance.CheckedBackColor = Color.FromArgb(0, 91, 127);

        loginButton.FlatAppearance.BorderSize = 0;
        loginButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(83, 221, 255);
        loginButton.FlatAppearance.MouseDownBackColor = Color.FromArgb(24, 168, 211);

        savePasswordCheck.CheckedChanged += (_, _) =>
        {
            savePasswordCheck.Text = savePasswordCheck.Checked
                ? "✓  Salvar senha"
                : "Salvar senha";
            savePasswordCheck.BackColor = savePasswordCheck.Checked
                ? Color.FromArgb(0, 91, 127)
                : Color.FromArgb(17, 30, 42);
            savePasswordCheck.ForeColor = Color.White;
        };

        loginButton.Click += async (_, _) => await LoginAsync();
        passwordBox.KeyDown += async (_, e) =>
        {
            if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                await LoginAsync();
            }
        };

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

        loginPanel.Resize += (_, _) =>
        {
            var width = loginPanel.ClientSize.Width;
            var height = loginPanel.ClientSize.Height;

            var heroWidth = Math.Max(520, (int)(width * 0.56));
            hero.SetBounds(0, 0, heroWidth, height);

            loginCard.Width = 500;
            loginCard.Height = 590;
            loginCard.Left = heroWidth + Math.Max(0, (width - heroWidth - loginCard.Width) / 2);
            loginCard.Top = Math.Max(28, (height - loginCard.Height) / 2);
        };

        loginPanel.PerformLayout();
    }

    private static Label NewLabel(string text, float size, FontStyle style, Color color)
    {
        return new Label
        {
            Text = text,
            ForeColor = color,
            Font = new Font("Segoe UI", size, style),
            AutoSize = true,
            BackColor = Color.Transparent
        };
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

            webView.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
                var path = uri.AbsolutePath.ToLowerInvariant();

                if (path == "/login" || path == "/portal.html" || path.StartsWith("/api/portal/"))
                {
                    e.Cancel = true;
                    BeginInvoke((Action)(() =>
                    {
                        statusLabel.Text = "A rota de cliente foi bloqueada no aplicativo Master.";
                        ShowLogin(true);
                    }));
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

            webView.CoreWebView2.NavigationCompleted += (_, e) =>
            {
                if (!webView.Visible) return;

                var source = webView.Source?.ToString() ?? "";
                if (!Uri.TryCreate(source, UriKind.Absolute, out var uri)) return;

                if (uri.AbsolutePath.Equals("/api/master/access", StringComparison.OrdinalIgnoreCase))
                {
                    statusLabel.Text = "A sessão administrativa expirou. Entre novamente.";
                    ShowLogin(true);
                }
                else if (!e.IsSuccess)
                {
                    statusLabel.Text = "Não foi possível carregar o Painel Master.";
                    ShowLogin(true);
                }
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

        if (webView.CoreWebView2 is null)
        {
            statusLabel.Text = "O aplicativo ainda está inicializando. Tente novamente em alguns segundos.";
            return;
        }

        loginButton.Enabled = false;
        loginButton.Text = "CONECTANDO...";
        statusLabel.ForeColor = Color.FromArgb(109, 207, 240);
        statusLabel.Text = "Validando credencial do Master...";

        try
        {
            using var http = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(20)
            };

            using var response = await http.PostAsJsonAsync(
                DesktopLoginUrl,
                new { username, password }
            );

            var raw = await response.Content.ReadAsStringAsync();

            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                statusLabel.ForeColor = Color.FromArgb(255, 137, 148);
                statusLabel.Text = "Usuário ou senha inválidos.";
                passwordBox.SelectAll();
                passwordBox.Focus();
                return;
            }

            if (!response.IsSuccessStatusCode)
            {
                statusLabel.ForeColor = Color.FromArgb(255, 137, 148);
                statusLabel.Text = "Servidor recusou o acesso. Código " + (int)response.StatusCode + ".";
                return;
            }

            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;

            if (!root.TryGetProperty("token", out var tokenElement))
            {
                statusLabel.ForeColor = Color.FromArgb(255, 137, 148);
                statusLabel.Text = "O servidor não devolveu a sessão do Master.";
                return;
            }

            var token = tokenElement.GetString();
            if (string.IsNullOrWhiteSpace(token))
            {
                statusLabel.ForeColor = Color.FromArgb(255, 137, 148);
                statusLabel.Text = "Sessão administrativa inválida.";
                return;
            }

            var manager = webView.CoreWebView2.CookieManager;
            manager.DeleteAllCookies();

            var cookie = manager.CreateCookie(
                "nexus_master",
                token,
                Host,
                "/"
            );
            cookie.IsHttpOnly = true;
            cookie.IsSecure = true;
            manager.AddOrUpdateCookie(cookie);

            if (savePasswordCheck.Checked)
            {
                SaveCredentials(username, password);
            }
            else
            {
                DeleteSavedCredentials();
            }

            statusLabel.Text = "";
            loginPanel.Visible = false;
            webView.Visible = true;
            webView.BringToFront();

            webView.CoreWebView2.Navigate(
                MasterConsoleUrl + "?desktop=1&v=" + Guid.NewGuid().ToString("N")
            );
        }
        catch (TaskCanceledException)
        {
            statusLabel.ForeColor = Color.FromArgb(255, 137, 148);
            statusLabel.Text = "A conexão demorou demais. Tente novamente.";
        }
        catch (Exception ex)
        {
            statusLabel.ForeColor = Color.FromArgb(255, 137, 148);
            statusLabel.Text = "Falha ao conectar: " + ex.Message;
        }
        finally
        {
            loginButton.Enabled = true;
            loginButton.Text = "ENTRAR NO MASTER";
        }
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
        catch { }
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

internal sealed class NexusBrandControl : Control
{
    public NexusBrandControl()
    {
        DoubleBuffered = true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);

        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

        var center = new PointF(52, 52);
        using var outerPen = new Pen(Color.FromArgb(70, 211, 255), 2.4f);
        using var innerPen = new Pen(Color.FromArgb(0, 111, 153), 1.2f);
        using var glowBrush = new SolidBrush(Color.FromArgb(24, 92, 215, 255));
        using var coreBrush = new SolidBrush(Color.FromArgb(77, 224, 255));

        e.Graphics.FillEllipse(glowBrush, 8, 8, 88, 88);
        e.Graphics.DrawEllipse(outerPen, 13, 13, 78, 78);
        e.Graphics.DrawEllipse(innerPen, 22, 22, 60, 60);
        e.Graphics.FillEllipse(coreBrush, 46, 46, 12, 12);

        using var nPen = new Pen(Color.FromArgb(208, 245, 255), 3.4f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round
        };
        e.Graphics.DrawLine(nPen, 31, 65, 31, 38);
        e.Graphics.DrawLine(nPen, 31, 38, 69, 65);
        e.Graphics.DrawLine(nPen, 69, 65, 69, 38);

        using var titleFont = new Font("Segoe UI Semibold", 24F, FontStyle.Bold);
        using var subFont = new Font("Segoe UI", 9.5F, FontStyle.Bold);
        using var titleBrush = new SolidBrush(Color.White);
        using var subBrush = new SolidBrush(Color.FromArgb(92, 215, 255));

        e.Graphics.DrawString("NEXUS AI", titleFont, titleBrush, 120, 24);
        e.Graphics.DrawString("MASTER SYSTEM", subFont, subBrush, 123, 66);
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
            Color.FromArgb(2, 8, 13),
            Color.FromArgb(1, 4, 7),
            LinearGradientMode.Horizontal
        );
        e.Graphics.FillRectangle(brush, rect);

        using var gridPen = new Pen(Color.FromArgb(10, 75, 142, 178), 1);
        const int step = 44;

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
