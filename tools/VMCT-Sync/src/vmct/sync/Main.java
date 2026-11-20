package vmct.sync;

import javax.swing.*;
import javax.swing.border.*;
import javax.swing.table.*;
import java.awt.*;
import java.awt.event.*;
import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.List;

/** VMCT Sync Terminal — compare a source checkout against a saved snapshot. */
public class Main {
    private JTextField sourceField, snapshotField;
    private JCheckBox pullBox, proxyBox;
    private JTextField proxyField;
    private JTable table;
    private DiffTableModel model;
    private JTextArea log;
    private Theme.StatCard cardAdded, cardChanged, cardRemoved;
    private JLabel statusLabel;
    private Map<String, Scanner.Doc> currentOld = new HashMap<>();
    private List<Scanner.Doc> currentNow = new ArrayList<>();
    private Scanner.Diff currentDiff = new Scanner.Diff();

    public static void main(String[] args) {
        System.setProperty("awt.useSystemAAFontSettings", "on");
        Theme.applyGlobal();
        SwingUtilities.invokeLater(() -> new Main().build());
    }

    private void build() {
        JFrame f = new JFrame("VMCT // SYNC TERMINAL");
        f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        f.setSize(1060, 720);
        f.setMinimumSize(new Dimension(900, 600));
        f.setLocationRelativeTo(null);
        f.setBackground(Theme.VOID);

        JPanel root = new JPanel(new BorderLayout());
        root.setBackground(Theme.VOID);
        root.setBorder(new EmptyBorder(0, 0, 0, 0));
        f.setContentPane(root);

        root.add(header(), BorderLayout.NORTH);
        root.add(center(), BorderLayout.CENTER);
        root.add(bottom(), BorderLayout.SOUTH);

        f.setVisible(true);
        log("READY // 选择源仓库目录后执行 SYNC");
    }

    private JPanel header() {
        JPanel h = new JPanel(new BorderLayout());
        h.setBackground(Theme.VOID);
        h.setBorder(new EmptyBorder(22, 26, 16, 26));
        JPanel left = new JPanel();
        left.setBackground(Theme.VOID);
        left.setLayout(new BoxLayout(left, BoxLayout.Y_AXIS));
        JLabel mark = new JLabel("VMCT  //  SYNC TERMINAL");
        mark.setFont(Theme.DISPLAY); mark.setForeground(Theme.ACCENT);
        JLabel sub = new JLabel("数据同步与差异比对  ·  静态档案构建辅助工具");
        sub.setFont(Theme.MONO_S); sub.setForeground(Theme.INK_3);
        sub.setBorder(new EmptyBorder(4, 2, 0, 0));
        left.add(mark); left.add(sub);
        JLabel coord = new JLabel("X:001 Y:028 Z:114  //  ARCHIVE-VM");
        coord.setFont(Theme.MONO_S); coord.setForeground(Theme.INK_3);
        h.add(left, BorderLayout.WEST);
        h.add(coord, BorderLayout.EAST);
        h.setBorder(BorderFactory.createCompoundBorder(
            new MatteBorder(0, 0, 1, 0, Theme.LINE_2),
            new EmptyBorder(22, 26, 16, 26)));
        return h;
    }

    private JPanel center() {
        JPanel c = new JPanel(new BorderLayout(0, 12));
        c.setBackground(Theme.VOID);
        c.setBorder(new EmptyBorder(16, 26, 12, 26));

        // config
        JPanel cfg = new JPanel(new GridBagLayout());
        cfg.setBackground(Theme.PANEL);
        cfg.setBorder(new CompoundBorder(new LineBorder(Theme.LINE), new EmptyBorder(14, 16, 14, 16)));
        GridBagConstraints g = new GridBagConstraints();
        g.insets = new Insets(4, 6, 4, 6); g.anchor = GridBagConstraints.WEST; g.fill = GridBagConstraints.HORIZONTAL;

        sourceField = Theme.field("");
        snapshotField = Theme.field("snapshot.tsv");
        pullBox = new JCheckBox("同步前 git pull"); pullBox.setSelected(false);
        proxyBox = new JCheckBox("代理"); proxyBox.setSelected(true);
        proxyField = Theme.field("127.0.0.1:7890");

        label(cfg, g, 0, 0, "源仓库目录 / SOURCE");
        add(cfg, g, 1, 0, sourceField, 1.0);
        JButton pick = Theme.button("浏览…");
        pick.addActionListener(e -> pickSource());
        add(cfg, g, 2, 0, pick, 0.0);

        label(cfg, g, 0, 1, "快照文件 / SNAPSHOT");
        add(cfg, g, 1, 1, snapshotField, 1.0);

        JButton sync = Theme.primary("▶  SYNC  同步比对");
        sync.addActionListener(e -> doSync());
        add(cfg, g, 2, 1, sync, 0.0);

        JPanel checks = new JPanel(new FlowLayout(FlowLayout.LEFT, 12, 0));
        checks.setBackground(Theme.PANEL);
        checks.add(pullBox);
        checks.add(proxyBox);
        checks.add(proxyField);
        proxyField.setPreferredSize(new Dimension(150, 32));
        g.gridwidth = 3;
        add(cfg, g, 0, 2, checks, 1.0);
        g.gridwidth = 1;
        c.add(cfg, BorderLayout.NORTH);

        // stats cards
        JPanel cards = new JPanel(new GridLayout(1, 3, 12, 0));
        cards.setBackground(Theme.VOID);
        cardAdded = new Theme.StatCard("NEW ENTRIES", () -> String.format("%02d", currentDiff.added.size()), Theme.ACCENT);
        cardChanged = new Theme.StatCard("CHANGED", () -> String.format("%02d", currentDiff.changed.size()), Theme.SIGNAL);
        cardRemoved = new Theme.StatCard("REMOVED", () -> String.format("%02d", currentDiff.removed.size()), Theme.RUN_MATURE);
        cards.add(cardAdded); cards.add(cardChanged); cards.add(cardRemoved);
        cards.setPreferredSize(new Dimension(100, 84));
        c.add(cards, BorderLayout.CENTER);

        // table + log split
        JPanel lower = new JPanel(new BorderLayout(12, 0));
        lower.setBackground(Theme.VOID);
        model = new DiffTableModel();
        table = new JTable(model) {
            protected void paintComponent(Graphics g) {
                super.paintComponent(g);
                Theme.corners(g, getWidth(), getHeight());
            }
        };
        table.setFont(Theme.MONO_S);
        table.setRowHeight(26);
        table.setGridColor(Theme.LINE);
        table.setShowGrid(true);
        table.setIntercellSpacing(new Dimension(0, 0));
        table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        table.getColumnModel().getColumn(0).setMaxWidth(90);
        table.getColumnModel().getColumn(1).setMaxWidth(110);
        table.getColumnModel().getColumn(2).setPreferredWidth(260);
        table.setDefaultRenderer(Object.class, new DiffRenderer());
        table.getTableHeader().setDefaultRenderer(new HeaderRenderer());
        table.getTableHeader().setBackground(Theme.PANEL);
        JScrollPane tsp = new JScrollPane(table);
        tsp.setBorder(new LineBorder(Theme.LINE_2));
        tsp.getViewport().setBackground(Theme.VOID);
        lower.add(tsp, BorderLayout.CENTER);

        log = new JTextArea();
        log.setEditable(false);
        log.setFont(Theme.MONO_S);
        log.setForeground(Theme.INK_2);
        log.setBackground(Theme.VOID);
        log.setBorder(new CompoundBorder(new LineBorder(Theme.LINE_2), new EmptyBorder(8, 10, 8, 10)));
        JScrollPane lsp = new JScrollPane(log);
        lsp.setPreferredSize(new Dimension(280, 0));
        lower.add(lsp, BorderLayout.EAST);
        lower.setPreferredSize(new Dimension(100, 300));
        c.add(lower, BorderLayout.SOUTH);
        return c;
    }

    private static void label(JPanel p, GridBagConstraints g, int x, int y, String t) {
        JLabel l = new JLabel(t);
        l.setFont(Theme.PLATE); l.setForeground(Theme.INK_3);
        g.gridx = x; g.gridy = y; g.gridwidth = 1; g.weightx = 0; g.fill = GridBagConstraints.NONE;
        p.add(l, g);
    }
    private static void add(JPanel p, GridBagConstraints g, int x, int y, JComponent c, double wx) {
        g.gridx = x; g.gridy = y; g.weightx = wx; g.fill = GridBagConstraints.HORIZONTAL;
        p.add(c, g);
    }

    private JPanel bottom() {
        JPanel b = new JPanel(new BorderLayout());
        b.setBackground(Theme.VOID);
        statusLabel = new JLabel("SYSTEM // IDLE");
        statusLabel.setFont(Theme.MONO_S); statusLabel.setForeground(Theme.INK_3);
        b.setBorder(new CompoundBorder(new MatteBorder(1, 0, 0, 0, Theme.LINE_2), new EmptyBorder(12, 26, 12, 26)));
        JPanel right = new JPanel(new FlowLayout(FlowLayout.RIGHT, 8, 0));
        right.setBackground(Theme.VOID);
        JButton apply = Theme.button("写入快照");
        apply.addActionListener(e -> applySnapshot());
        JButton export = Theme.button("导出报告");
        export.addActionListener(e -> exportReport());
        right.add(apply); right.add(export);
        b.add(statusLabel, BorderLayout.WEST);
        b.add(right, BorderLayout.EAST);
        return b;
    }

    private void pickSource() {
        JFileChooser ch = new JFileChooser();
        ch.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        ch.setDialogTitle("选择源仓库根目录（含 src/pages）");
        if (ch.showOpenDialog(this.sourceField) == JFileChooser.APPROVE_OPTION) {
            sourceField.setText(ch.getSelectedFile().getAbsolutePath());
        }
    }

    private void doSync() {
        Path src = Path.of(sourceField.getText().trim());
        if (!Files.isDirectory(src)) { log("ERR // 源目录不存在: " + src); return; }
        setBusy(true);
        new SwingWorker<Void, String>() {
            protected Void doInBackground() {
                try {
                    if (pullBox.isSelected()) {
                        publish("GIT // 拉取上游更新…");
                        runGit(src);
                    }
                    publish("SCAN // 解析内容页…");
                    currentNow = Scanner.scan(src);
                    Path snap = resolveSnapshot();
                    currentOld = Scanner.loadSnapshot(snap);
                    publish("DIFF // 比对快照…");
                    currentDiff = Scanner.diff(currentOld, currentNow);
                    publish("DONE // 新增 " + currentDiff.added.size()
                          + " · 更新 " + currentDiff.changed.size()
                          + " · 移除 " + currentDiff.removed.size());
                } catch (Exception e) {
                    publish("ERR // " + e.getMessage());
                }
                return null;
            }
            protected void process(java.util.List<String> chunks) {
                for (String s : chunks) log(s);
            }
            protected void done() {
                setBusy(false);
                model.setDiff(currentDiff);
                cardAdded.repaint(); cardChanged.repaint(); cardRemoved.repaint();
                statusLabel.setText("SYSTEM // COMPARED @ " + LocalTime.now().withNano(0));
                statusLabel.setForeground(Theme.ACCENT);
            }
        }.execute();
    }

    private void runGit(Path src) throws IOException, InterruptedException {
        String proxy = proxyField.getText().trim();
        var cmd = new ArrayList<String>();
        cmd.add("git");
        if (proxyBox.isSelected() && !proxy.isEmpty()) {
            cmd.add("-c"); cmd.add("http.proxy=http://" + proxy);
            cmd.add("-c"); cmd.add("https.proxy=http://" + proxy);
        }
        cmd.add("-C"); cmd.add(src.toString()); cmd.add("pull"); cmd.add("--ff-only");
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        try (var r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
            String line;
            while ((line = r.readLine()) != null) log("  " + line);
        }
        int code = p.waitFor();
        if (code != 0) log("GIT // pull 返回 " + code + "（可忽略，继续用本地数据比对）");
    }

    private Path resolveSnapshot() {
        String s = snapshotField.getText().trim();
        Path p = Path.of(s);
        return p.isAbsolute() ? p : Path.of("").toAbsolutePath().resolve(p);
    }

    private void applySnapshot() {
        if (currentNow.isEmpty()) { log("ERR // 尚无扫描结果"); return; }
        try {
            Path snap = resolveSnapshot();
            Scanner.saveSnapshot(snap, currentNow);
            log("SNAPSHOT // 已写入 " + snap.getFileName() + "（" + currentNow.size() + " 条）");
            currentOld = Scanner.loadSnapshot(snap);
            currentDiff = Scanner.diff(currentOld, currentNow);
            model.setDiff(currentDiff);
            cardAdded.repaint(); cardChanged.repaint(); cardRemoved.repaint();
        } catch (Exception e) { log("ERR // " + e.getMessage()); }
    }

    private void exportReport() {
        if (currentDiff.added.isEmpty() && currentDiff.changed.isEmpty() && currentDiff.removed.isEmpty()) {
            log("ERR // 没有差异可导出"); return;
        }
        JFileChooser ch = new JFileChooser();
        ch.setSelectedFile(new File("vmct-sync-report.md"));
        if (ch.showSaveDialog(sourceField) != JFileChooser.APPROVE_OPTION) return;
        try {
            StringBuilder sb = new StringBuilder();
            sb.append("# 数据同步差异报告\n\n");
            sb.append("生成时间：").append(LocalDateTime.now().withNano(0)).append("\n\n");
            sb.append("| 类型 | ID | 标题 | 状态 |\n|---|---|---|---|\n");
            for (var d : currentDiff.added) sb.append("| 新增 | ").append(d.id).append(" | ").append(d.title).append(" | ").append(d.status).append(" |\n");
            for (var d : currentDiff.changed) sb.append("| 更新 | ").append(d.id).append(" | ").append(d.title).append(" | ").append(d.status).append(" |\n");
            for (var d : currentDiff.removed) sb.append("| 移除 | ").append(d.id).append(" | ").append(d.title).append(" | — |\n");
            Files.writeString(ch.getSelectedFile().toPath(), sb.toString());
            log("EXPORT // 报告已写出");
        } catch (Exception e) { log("ERR // " + e.getMessage()); }
    }

    private void setBusy(boolean b) {
        statusLabel.setText(b ? "SYSTEM // WORKING…" : "SYSTEM // READY");
        statusLabel.setForeground(b ? Theme.SIGNAL : Theme.INK_3);
    }

    private void log(String s) {
        if (log == null) return;
        log.append("> " + s + "\n");
        log.setCaretPosition(log.getDocument().getLength());
    }

    // ---------- table model / renderer ----------
    static class DiffTableModel extends AbstractTableModel {
        private final String[] cols = {"TYPE", "KIND", "TITLE / ID", "STATUS", "HASH"};
        private final List<Object[]> rows = new ArrayList<>();
        void setDiff(Scanner.Diff d) {
            rows.clear();
            for (var x : d.added) rows.add(new Object[]{"NEW", x.kind, x.title + "  [" + x.id + "]", x.status, x.hash});
            for (var x : d.changed) rows.add(new Object[]{"CHANGED", x.kind, x.title + "  [" + x.id + "]", x.status, x.hash});
            for (var x : d.removed) rows.add(new Object[]{"REMOVED", x.kind, x.title + "  [" + x.id + "]", "—", "--------"});
            fireTableDataChanged();
        }
        public int getRowCount() { return rows.size(); }
        public int getColumnCount() { return cols.length; }
        public String getColumnName(int c) { return cols[c]; }
        public Object getValueAt(int r, int c) { return rows.get(r)[c]; }
    }

    static class HeaderRenderer extends DefaultTableCellRenderer {
        HeaderRenderer() {
            setBackground(Theme.PANEL);
            setForeground(Theme.INK_3);
            setFont(Theme.PLATE);
            setBorder(new CompoundBorder(new MatteBorder(0, 0, 1, 1, Theme.LINE_2), new EmptyBorder(0, 8, 0, 8)));
            setHorizontalAlignment(LEFT);
        }
        public Component getTableCellRendererComponent(JTable t, Object v, boolean sel, boolean focus, int r, int c) {
            setText(String.valueOf(v));
            return this;
        }
    }

    static class DiffRenderer extends DefaultTableCellRenderer {
        protected void setValue(Object v) { super.setValue(v == null ? "" : v); }
        public Component getTableCellRendererComponent(JTable t, Object v, boolean sel, boolean focus, int r, int c) {
            Component cmp = super.getTableCellRendererComponent(t, v, sel, focus, r, c);
            setFont(Theme.MONO_S);
            setBorder(new EmptyBorder(0, 8, 0, 8));
            if (sel) return cmp;
            String type = String.valueOf(t.getValueAt(r, 0));
            Color fg = Theme.INK_2;
            if (c == 0) {
                fg = type.equals("NEW") ? Theme.ACCENT : type.equals("CHANGED") ? Theme.SIGNAL : Theme.RUN_MATURE;
                setFont(Theme.PLATE);
            } else if (c == 4) fg = Theme.INK_3;
            setForeground(fg);
            setBackground(r % 2 == 0 ? Theme.VOID : new Color(0x10, 0x12, 0x10));
            return cmp;
        }
    }
}
