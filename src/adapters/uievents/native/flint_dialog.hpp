// CFIRE-UPSTREAM: CF-077
//
// Open and save file dialogs on Linux (src/adapters/uievents/dialogs.cf). ext:webui's
// open_file_dialog / save_file_dialog are macOS-only and return "" elsewhere without
// showing anything (CF-077), so on Linux this shim runs a GTK 3 file chooser, modal over
// the app window, the way NSOpenPanel/NSSavePanel run on macOS. Called from a webui
// binding, which runs on the GTK main thread.
#pragma once

#include <cstdlib>
#include <string>

#if defined(__linux__)
#include <gtk/gtk.h>
#endif

namespace flint_dialog {

// True where this shim shows the dialog itself; elsewhere the caller uses ext:webui's.
inline bool native() {
#if defined(__linux__)
    return true;
#else
    return false;
#endif
}

// `save` picks a file to create (with `default_name` filled in), otherwise an existing
// file to open. Returns the chosen path, or "" when cancelled.
inline std::string choose(bool save, const std::string& title, const std::string& default_name) {
#if defined(__linux__)
    if (const char* h = std::getenv("CFIRE_HEADLESS_TEST"); h && std::string(h) == "1") return "";
    GtkWindow* parent = nullptr;
    GList* tops = gtk_window_list_toplevels();
    for (GList* l = tops; l; l = l->next) {
        if (gtk_window_is_active(GTK_WINDOW(l->data))) {
            parent = GTK_WINDOW(l->data);
            break;
        }
    }
    if (!parent && tops) parent = GTK_WINDOW(tops->data);
    g_list_free(tops);

    GtkWidget* d = gtk_file_chooser_dialog_new(
        title.c_str(), parent, save ? GTK_FILE_CHOOSER_ACTION_SAVE : GTK_FILE_CHOOSER_ACTION_OPEN,
        "_Cancel", GTK_RESPONSE_CANCEL, save ? "_Save" : "_Open", GTK_RESPONSE_ACCEPT, nullptr);
    GtkFileChooser* fc = GTK_FILE_CHOOSER(d);
    gtk_window_set_modal(GTK_WINDOW(d), TRUE);
    gtk_file_chooser_set_local_only(fc, TRUE);
    if (save) {
        gtk_file_chooser_set_do_overwrite_confirmation(fc, TRUE);
        gtk_file_chooser_set_current_folder(fc, g_get_home_dir());
        if (!default_name.empty()) gtk_file_chooser_set_current_name(fc, default_name.c_str());
    }
    std::string out;
    if (gtk_dialog_run(GTK_DIALOG(d)) == GTK_RESPONSE_ACCEPT) {
        if (char* p = gtk_file_chooser_get_filename(fc)) {
            out = p;
            g_free(p);
        }
    }
    gtk_widget_destroy(d);
    return out;
#else
    (void)save;
    (void)title;
    (void)default_name;
    return "";
#endif
}

}  // namespace flint_dialog
