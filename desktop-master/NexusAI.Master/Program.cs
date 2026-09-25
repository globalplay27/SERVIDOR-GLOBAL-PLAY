using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace NexusAIMaster;

internal static class Program
{
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NEXUS AI Master",
        "startup.log"
    );

    [STAThread]
    static void Main()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            Log("START");

            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (_, e) => Fail("THREAD", e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
                Log("DOMAIN: " + (e.ExceptionObject?.ToString() ?? "unknown"));
            TaskScheduler.UnobservedTaskException += (_, e) =>
            {
                Log("TASK: " + e.Exception);
                e.SetObserved();
            };

            ApplicationConfiguration.Initialize();

            using var form = new MainForm();
            Log("MAIN_FORM_CREATED");
            Application.Run(form);
            Log("EXIT");
        }
        catch (Exception ex)
        {
            Fail("STARTUP", ex);
        }
    }

    private static void Fail(string stage, Exception ex)
    {
        Log(stage + ": " + ex);
        try
        {
            MessageBox.Show(
                "O NEXUS AI MASTER encontrou um erro ao iniciar.\n\n" +
                "O diagnóstico foi salvo em:\n" + LogPath + "\n\n" +
                ex.Message,
                "NEXUS AI MASTER",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        catch { }
    }

    private static void Log(string message)
    {
        try
        {
            File.AppendAllText(
                LogPath,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + Environment.NewLine
            );
        }
        catch { }
    }
}
