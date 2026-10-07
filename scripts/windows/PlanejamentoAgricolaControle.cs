using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    private const string MutexName = "PlanejamentoAgricolaTrayMutex";
    private const string RunValueName = "PlanejamentoAgricola";
    private const string AppTitle = "Controle Agricola";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        ServiceHost host = new ServiceHost();

        string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "";
        if (mode == "--stop")
        {
            host.Stop();
            return 0;
        }
        if (mode == "--start")
        {
            return host.Start(false) ? 0 : 1;
        }
        if (mode == "--uninstall")
        {
            host.Stop();
            host.SetAutoStart(false);
            return 0;
        }
        if (mode == "--install")
        {
            host.SetAutoStart(true);
            return host.Start(false) ? 0 : 1;
        }

        bool background = mode == "--background";
        bool created;
        using (Mutex mutex = new Mutex(true, MutexName, out created))
        {
            if (!created)
            {
                if (!background) host.OpenBrowser();
                return 0;
            }
            if (background) host.SetAutoStart(true);
            if (!host.Start(false) && !host.IsHealthy())
            {
                MessageBox.Show(
                    host.LastError,
                    AppTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }
            return RunTray(host, !background);
        }
    }

    private static int RunTray(ServiceHost host, bool openBrowser)
    {
        if (openBrowser) host.OpenBrowser();
        Application.Run(new TrayContext(host));
        return 0;
    }
}

internal sealed class ServiceHost
{
    private const string RunValueName = "PlanejamentoAgricola";
    private readonly string appDir;
    private readonly string exeDir;
    private readonly string pidPath;
    private readonly string logDir;
    private readonly string logPath;
    private readonly int port;
    public string LastError = "";

    public ServiceHost()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        this.exeDir = baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string parent = Directory.GetParent(this.exeDir) != null
            ? Directory.GetParent(this.exeDir).FullName
            : this.exeDir;
        this.appDir = File.Exists(Path.Combine(parent, "package.json")) ? parent : this.exeDir;
        this.pidPath = Path.Combine(this.exeDir, "planejamento.pid");
        this.logDir = Path.Combine(this.exeDir, "logs");
        this.logPath = Path.Combine(this.logDir, "servico.log");
        this.port = ReadPort();
    }

    public string AppUrl
    {
        get { return "http://localhost:" + this.port + "/"; }
    }

    public int Port
    {
        get { return this.port; }
    }

    public string ExePath
    {
        get { return Path.Combine(this.exeDir, "PlanejamentoAgricola.exe"); }
    }

    private int ReadPort()
    {
        try
        {
            string envPath = Path.Combine(this.appDir, ".env");
            if (File.Exists(envPath))
            {
                string[] lines = File.ReadAllLines(envPath);
                for (int i = 0; i < lines.Length; i++)
                {
                    string line = lines[i].Trim();
                    if (line.StartsWith("PLANEJAMENTO_APP_PORT="))
                    {
                        int parsed;
                        if (int.TryParse(line.Substring("PLANEJAMENTO_APP_PORT=".Length).Trim(), out parsed) && parsed > 0)
                            return parsed;
                    }
                }
            }
        }
        catch
        {
        }
        return 5173;
    }

    public bool IsHealthy()
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + this.port + "/api/health");
            req.Timeout = 1500;
            req.Proxy = null;
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
            {
                return (int)res.StatusCode >= 200 && (int)res.StatusCode < 300;
            }
        }
        catch
        {
            return false;
        }
    }

    public bool Start(bool forceRestart)
    {
        this.LastError = "";
        if (!forceRestart && this.IsHealthy()) return true;

        this.Stop();

        string node = FindNode();
        if (node == null)
        {
            this.LastError = "Node.js nao encontrado. Instale o Node.js e tente de novo.";
            return false;
        }

        string tsx = Path.Combine(this.appDir, "node_modules", "tsx", "dist", "cli.mjs");
        if (!File.Exists(tsx))
        {
            this.LastError = "Dependencias ausentes. Abra a pasta do app e rode npm install.";
            return false;
        }

        try
        {
            Directory.CreateDirectory(this.logDir);
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = node;
            psi.Arguments = "\"" + tsx + "\" server/index.ts";
            psi.WorkingDirectory = this.appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            if (psi.EnvironmentVariables.ContainsKey("NODE_ENV"))
                psi.EnvironmentVariables["NODE_ENV"] = "production";
            else
                psi.EnvironmentVariables.Add("NODE_ENV", "production");
            if (psi.EnvironmentVariables.ContainsKey("PLANEJAMENTO_API_PORT"))
                psi.EnvironmentVariables["PLANEJAMENTO_API_PORT"] = this.port.ToString();
            else
                psi.EnvironmentVariables.Add("PLANEJAMENTO_API_PORT", this.port.ToString());
            if (psi.EnvironmentVariables.ContainsKey("PORT"))
                psi.EnvironmentVariables["PORT"] = this.port.ToString();
            else
                psi.EnvironmentVariables.Add("PORT", this.port.ToString());

            Process proc = new Process();
            proc.StartInfo = psi;
            proc.EnableRaisingEvents = false;
            proc.OutputDataReceived += this.AppendLog;
            proc.ErrorDataReceived += this.AppendLog;
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            File.WriteAllText(this.pidPath, proc.Id.ToString());

            DateTime until = DateTime.UtcNow.AddSeconds(20);
            while (DateTime.UtcNow < until)
            {
                if (this.IsHealthy()) return true;
                if (proc.HasExited)
                {
                    this.LastError = "O servico encerrou ao iniciar. Veja o log em " + this.logPath;
                    return false;
                }
                Thread.Sleep(400);
            }

            if (this.IsHealthy()) return true;
            this.LastError = "O servico nao respondeu a tempo na porta " + this.port + ".";
            return false;
        }
        catch (Exception ex)
        {
            this.LastError = "Falha ao iniciar: " + ex.Message;
            return false;
        }
    }

    public void Stop()
    {
        int pid = 0;
        if (File.Exists(this.pidPath))
        {
            int.TryParse(File.ReadAllText(this.pidPath).Trim(), out pid);
        }
        if (pid > 0) KillTree(pid);

        int listener = FindPidOnPort(this.port);
        if (listener > 0) KillTree(listener);

        try { if (File.Exists(this.pidPath)) File.Delete(this.pidPath); }
        catch { }
    }

    public void OpenBrowser()
    {
        string url = this.AppUrl;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = url;
            psi.UseShellExecute = true;
            Process.Start(psi);
        }
        catch (Exception)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "cmd.exe";
                psi.Arguments = "/c start \"\" \"" + url + "\"";
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch
            {
            }
        }
    }

    public bool AutoStartEnabled()
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(
                "Software\\Microsoft\\Windows\\CurrentVersion\\Run", false))
            {
                if (key == null) return false;
                object value = key.GetValue(RunValueName);
                return value != null && value.ToString().Length > 0;
            }
        }
        catch
        {
            return false;
        }
    }

    public void SetAutoStart(bool enabled)
    {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run", true))
        {
            if (key == null) return;
            if (enabled)
                key.SetValue(RunValueName, "\"" + this.ExePath + "\" --background");
            else
                key.DeleteValue(RunValueName, false);
        }
    }

    private void AppendLog(object sender, DataReceivedEventArgs e)
    {
        if (e.Data == null) return;
        try
        {
            Directory.CreateDirectory(this.logDir);
            File.AppendAllText(this.logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + e.Data + Environment.NewLine);
        }
        catch
        {
        }
    }

    private static string FindNode()
    {
        string[] candidates = new string[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe")
        };
        for (int i = 0; i < candidates.Length; i++)
        {
            if (File.Exists(candidates[i])) return candidates[i];
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "where.exe";
            psi.Arguments = "node.exe";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            Process p = Process.Start(psi);
            string output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(4000);
            string[] lines = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length > 0 && File.Exists(lines[0].Trim())) return lines[0].Trim();
        }
        catch
        {
        }
        return null;
    }

    private static void KillTree(int pid)
    {
        if (pid <= 0) return;
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "taskkill";
            psi.Arguments = "/PID " + pid + " /T /F";
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            Process p = Process.Start(psi);
            if (p != null) p.WaitForExit(8000);
        }
        catch
        {
        }
    }

    private static int FindPidOnPort(int port)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "netstat";
            psi.Arguments = "-ano -p tcp";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            Process p = Process.Start(psi);
            string output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(5000);
            Regex rx = new Regex(@":" + port + @"\s+\S+\s+LISTENING\s+(\d+)", RegexOptions.IgnoreCase);
            Match m = rx.Match(output);
            if (m.Success)
            {
                int pid;
                if (int.TryParse(m.Groups[1].Value, out pid)) return pid;
            }
        }
        catch
        {
        }
        return 0;
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly ServiceHost host;
    private readonly NotifyIcon tray;
    private readonly Icon iconOn;
    private readonly Icon iconOff;
    private readonly ToolStripMenuItem statusItem;
    private readonly ToolStripMenuItem autoStartItem;
    private readonly System.Windows.Forms.Timer timer;

    public TrayContext(ServiceHost host)
    {
        this.host = host;
        this.iconOn = MakeIcon(Color.FromArgb(46, 160, 67));
        this.iconOff = MakeIcon(Color.FromArgb(120, 120, 120));

        ContextMenuStrip menu = new ContextMenuStrip();
        this.statusItem = new ToolStripMenuItem("Verificando...");
        this.statusItem.Enabled = false;
        menu.Items.Add(this.statusItem);
        menu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem open = new ToolStripMenuItem("Abrir no navegador");
        open.Click += delegate { this.host.OpenBrowser(); };
        menu.Items.Add(open);

        ToolStripMenuItem start = new ToolStripMenuItem("Iniciar servico");
        start.Click += this.OnStart;
        menu.Items.Add(start);

        ToolStripMenuItem stop = new ToolStripMenuItem("Encerrar servico");
        stop.Click += this.OnStop;
        menu.Items.Add(stop);

        menu.Items.Add(new ToolStripSeparator());
        this.autoStartItem = new ToolStripMenuItem("Iniciar com o Windows");
        this.autoStartItem.Click += this.OnToggleAutoStart;
        menu.Items.Add(this.autoStartItem);

        menu.Items.Add(new ToolStripSeparator());
        ToolStripMenuItem exit = new ToolStripMenuItem("Sair do icone (servico continua)");
        exit.Click += delegate { Application.Exit(); };
        menu.Items.Add(exit);

        this.tray = new NotifyIcon();
        this.tray.ContextMenuStrip = menu;
        this.tray.Visible = true;
        this.tray.Text = "Controle Agricola";
        this.tray.DoubleClick += delegate { this.host.OpenBrowser(); };

        this.timer = new System.Windows.Forms.Timer();
        this.timer.Interval = 3000;
        this.timer.Tick += delegate { this.RefreshStatus(); };
        this.timer.Start();
        this.RefreshStatus();
        this.tray.ShowBalloonTip(2500, "Controle Agricola", "Servico em " + this.host.AppUrl + " Clique duas vezes para abrir.", ToolTipIcon.Info);
    }

    private void OnStart(object sender, EventArgs e)
    {
        if (!this.host.Start(false) && !this.host.IsHealthy())
        {
            MessageBox.Show(this.host.LastError, "Controle Agricola", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        this.RefreshStatus();
    }

    private void OnStop(object sender, EventArgs e)
    {
        this.host.Stop();
        this.RefreshStatus();
    }

    private void OnToggleAutoStart(object sender, EventArgs e)
    {
        this.host.SetAutoStart(!this.host.AutoStartEnabled());
        this.RefreshStatus();
    }

    private void RefreshStatus()
    {
        bool running = this.host.IsHealthy();
        this.tray.Icon = running ? this.iconOn : this.iconOff;
        this.tray.Text = running
            ? "Controle Agricola em execucao"
            : "Controle Agricola parado";
        this.statusItem.Text = running
            ? "Status: em execucao (" + this.host.AppUrl + ")"
            : "Status: parado";
        this.autoStartItem.Checked = this.host.AutoStartEnabled();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            this.timer.Stop();
            this.timer.Dispose();
            this.tray.Visible = false;
            this.tray.Dispose();
            this.iconOn.Dispose();
            this.iconOff.Dispose();
        }
        base.Dispose(disposing);
    }

    private static Icon MakeIcon(Color color)
    {
        Bitmap bmp = new Bitmap(16, 16);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using (SolidBrush brush = new SolidBrush(color))
            {
                g.FillEllipse(brush, 1, 1, 14, 14);
            }
        }
        IntPtr handle = bmp.GetHicon();
        Icon icon = Icon.FromHandle(handle);
        Icon clone = (Icon)icon.Clone();
        icon.Dispose();
        bmp.Dispose();
        return clone;
    }
}
