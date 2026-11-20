package vmct.sync;

import javax.swing.*;
import javax.swing.border.*;
import java.awt.*;

/** Graphic-Realism palette for Swing: one dark base, one acid accent, hard edges. */
final class Theme {
    static final Color VOID      = new Color(0x0B, 0x0D, 0x0B);
    static final Color PANEL     = new Color(0x27, 0x27, 0x33);
    static final Color OVERLAY   = new Color(0x2E, 0x2F, 0x38);
    static final Color INK       = new Color(0xDF, 0xDE, 0xE0);
    static final Color INK_2     = new Color(0xDF, 0xDE, 0xE0, 184);
    static final Color INK_3     = new Color(0xDF, 0xDE, 0xE0, 115);
    static final Color LINE      = new Color(0x27, 0x27, 0x33);
    static final Color LINE_2    = new Color(0x2E, 0x2F, 0x38);
    static final Color ACCENT    = new Color(0xC0, 0xFE, 0x04);
    static final Color ACCENT_INK= new Color(0x0B, 0x0D, 0x0B);
    static final Color SIGNAL    = new Color(0xFF, 0x00, 0x3C);
    static final Color RUN_MATURE= new Color(0x8F, 0x96, 0xB2);

    private static final String CJK = "\u5fae\u8f6f\u96c5\u9ed1"; // Microsoft YaHei (encoded to avoid source-encoding issues)
    static final Font UI     = new Font(CJK, Font.PLAIN, 13);
    static final Font UI_BOLD= new Font(CJK, Font.BOLD, 13);
    static final Font MONO   = new Font(CJK, Font.PLAIN, 12);
    static final Font MONO_S = new Font(CJK, Font.PLAIN, 11);
    static final Font DISPLAY= new Font("Consolas", Font.BOLD, 22);   // ASCII-only brand mark
    static final Font PLATE  = new Font(CJK, Font.BOLD, 11);

    private Theme() {}

    static void applyGlobal() {
        UIManager.put("Panel.background", VOID);
        UIManager.put("OptionPane.background", VOID);
        UIManager.put("OptionPane.messageForeground", INK);
        UIManager.put("Label.foreground", INK);
        UIManager.put("TextField.background", VOID);
        UIManager.put("TextField.foreground", INK);
        UIManager.put("TextField.caretForeground", ACCENT);
        UIManager.put("TextField.selectionBackground", ACCENT);
        UIManager.put("TextField.selectionForeground", ACCENT_INK);
        UIManager.put("Button.background", VOID);
        UIManager.put("Button.foreground", INK);
        UIManager.put("Table.background", VOID);
        UIManager.put("Table.foreground", INK);
        UIManager.put("Table.selectionBackground", ACCENT);
        UIManager.put("Table.selectionForeground", ACCENT_INK);
        UIManager.put("Table.gridColor", LINE_2);
        UIManager.put("ScrollPane.background", VOID);
        UIManager.put("Viewport.background", VOID);
        UIManager.put("CheckBox.background", VOID);
        UIManager.put("CheckBox.foreground", INK);
        UIManager.put("CheckBox.focus", ACCENT);
        UIManager.put("TitledBorder.titleColor", INK_3);
    }

    static JButton button(String text) {
        JButton b = new JButton(text);
        b.setFont(PLATE);
        b.setForeground(INK);
        b.setBackground(VOID);
        b.setFocusPainted(false);
        b.setBorder(new CompoundBorder(new LineBorder(LINE_2), new EmptyBorder(9, 14, 9, 14)));
        b.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        b.addMouseListener(new java.awt.event.MouseAdapter() {
            public void mouseEntered(java.awt.event.MouseEvent e) {
                b.setBackground(ACCENT); b.setForeground(ACCENT_INK); b.setBorder(new CompoundBorder(new LineBorder(ACCENT), new EmptyBorder(9, 14, 9, 14)));
            }
            public void mouseExited(java.awt.event.MouseEvent e) {
                b.setBackground(VOID); b.setForeground(INK); b.setBorder(new CompoundBorder(new LineBorder(LINE_2), new EmptyBorder(9, 14, 9, 14)));
            }
        });
        return b;
    }

    static JButton primary(String text) {
        JButton b = button(text);
        b.setBackground(ACCENT); b.setForeground(ACCENT_INK);
        b.setBorder(new CompoundBorder(new LineBorder(ACCENT), new EmptyBorder(9, 14, 9, 14)));
        final boolean[] hot = {false};
        b.addMouseListener(new java.awt.event.MouseAdapter() {
            public void mouseEntered(java.awt.event.MouseEvent e) { hot[0] = true; b.setBackground(VOID); b.setForeground(ACCENT); }
            public void mouseExited(java.awt.event.MouseEvent e) { hot[0] = false; b.setBackground(ACCENT); b.setForeground(ACCENT_INK); }
        });
        return b;
    }

    static JTextField field(String text) {
        JTextField f = new JTextField(text);
        f.setFont(MONO_S);
        f.setForeground(INK);
        f.setBackground(VOID);
        f.setCaretColor(ACCENT);
        f.setBorder(new CompoundBorder(new LineBorder(LINE_2), new EmptyBorder(8, 10, 8, 10)));
        return f;
    }

    /** A titled plate + value stat card, drawn by hand. */
    static class StatCard extends JPanel {
        private final String plate;
        private final java.util.function.Supplier<String> value;
        private final Color tint;
        StatCard(String plate, java.util.function.Supplier<String> value, Color tint) {
            this.plate = plate; this.value = value; this.tint = tint;
            setBackground(PANEL);
            setBorder(new CompoundBorder(new LineBorder(LINE_2), new EmptyBorder(14, 16, 14, 16)));
            setPreferredSize(new Dimension(180, 84));
        }
        protected void paintComponent(Graphics g) {
            super.paintComponent(g);
            Graphics2D g2 = (Graphics2D) g.create();
            g2.setColor(tint); g2.fillRect(0, 0, 3, getHeight());
            g2.setFont(PLATE); g2.setColor(INK_3);
            g2.drawString(plate, 16, 22);
            g2.setFont(DISPLAY); g2.setColor(ACCENT);
            g2.drawString(value.get(), 16, 60);
            g2.dispose();
        }
    }

    /** Corner brackets painted inside a component's own bounds. */
    static void corners(Graphics g, int w, int h) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setColor(ACCENT); g2.setStroke(new BasicStroke(1.5f));
        int a = 14, arm = 10;
        g2.drawLine(0, a, 0, 0); g2.drawLine(0, 0, arm, 0);
        g2.drawLine(w - arm, 0, w, 0); g2.drawLine(w, 0, w, a);
        g2.drawLine(0, h - a, 0, h); g2.drawLine(0, h, arm, h);
        g2.drawLine(w - arm, h, w, h); g2.drawLine(w, h, w, h - a);
        g2.dispose();
    }
}
