const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Util = Me.imports.util;

function LOG(message) {
	// log("[pixel-saver]: " + message);
}

function WARN(message) {
	log("[pixel-saver]: " + message);
}

/**
 * Buttons
 */
const DCONF_META_PATH = 'org.gnome.desktop.wm.preferences';

let actors = [], boxes = [];
function createButtons() {
	// Ensure we do not create buttons twice.
	destroyButtons();
	
	actors = [
		new St.Bin({ style_class: 'box-bin'}),
		new St.Bin({ style_class: 'box-bin'})
	];
	
	boxes = [
		new St.BoxLayout({ style_class: 'button-box' }),
		new St.BoxLayout({ style_class: 'button-box' })
	];
	
	actors.forEach(function(actor, i) {
		actor.add_actor(boxes[i]);
	});
	
	let order = new Gio.Settings({schema_id: DCONF_META_PATH}).get_string('button-layout');
	LOG('Buttons layout : ' + order);
	
	if (order.indexOf(':') == -1 && order.length <= 1) {
		LOG('Button layout empty')
		return
	}
	
	let orders = order.replace(/ /g, '').split(':');
	
	orders[0] = orders[0].split(',');
	
	// Check if it actually exists, if not then create it
	if(typeof orders[1] == 'undefined') {
		orders[1] = '';
	// If the button layout is explicit defined as empty, do nothing
	} else if(orders[1].length == 0) {
		return;
	}
	orders[1] = orders[1].split(',');
	
	const callbacks = {
		minimize : minimize,
		maximize : maximize,
		close    : close
	};
	
	for (let bi = 0; bi < boxes.length; ++bi) {
		let order = orders[bi],
			box = boxes[bi];
		
		for (let i = 0; i < order.length; ++i) {
			if (!order[i]) {
				continue;
			}
			
			if (!callbacks[order[i]]) {
				// Skip if the button's name is not right...
				WARN("\'%s\' is not a valid button.".format(order[i]));
				continue;
			}
			
			let button = new St.Button({
				style_class: order[i]  + ' window-button',
				track_hover: true
			});
			
			button.connect('button-release-event', leftclick(callbacks[order[i]]));
			box.add(button);
		}
	}
	
	Mainloop.idle_add(function () {
		// 1 for activity button and -1 for the menu
		if (boxes[0].get_children().length) {
			Main.panel._leftBox.insert_child_at_index(actors[0], 1);
		}
		
		if (boxes[1].get_children().length) {
			Main.panel._rightBox.insert_child_at_index(actors[1], Main.panel._rightBox.get_children().length - 1);
		}
		
		updateVisibility();
		return false;
	});
}

function destroyButtons() {
	actors.forEach(function(actor, i) {
		actor.destroy();
		boxes[i].destroy();
	});
	
	actors = [];
	boxes = [];
}

/**
 * Buttons actions
 */
function leftclick(callback) {
	return function(actor, event) {
		if (event.get_button() !== 1) {
			return null;
		}
		
		return callback(actor, event);
	}
}

function minimize() {
	let win = Util.getWindow();
	if (!win || win.minimized) {
		WARN('impossible to minimize');
		return;
	}
	
	win.minimize();
}

function maximize() {
	let win = Util.getWindow();
	if (!win) {
		WARN('impossible to maximize');
		return;
	}
	
	const MAXIMIZED = Meta.MaximizeFlags.BOTH;
	if (win.get_maximized() === MAXIMIZED) {
		win.unmaximize(MAXIMIZED);
	} else {
		WARN('window shoud already be maximized');
		win.maximize(MAXIMIZED);
	}
	
	win.activate(global.get_current_time());
}

function close() {
	let win = Util.getWindow();
	if (!win) {
		WARN('impossible to close');
		return;
	}
	
	win.delete(global.get_current_time());
}

/**
 * Theming
 */
let activeCSS = false;

let gtk_settings = Gtk.Settings.get_default();

function loadTheme() {
    if (!gtk_settings) {
        return;
    }

	let theme = gtk_settings.gtk_theme_name,
		cssPath = GLib.build_filenamev([extensionPath, 'themes', theme, 'style.css']);
	
	LOG('Load theme ' + theme);
	if (!GLib.file_test(cssPath, GLib.FileTest.EXISTS)) {
		cssPath = GLib.build_filenamev([extensionPath, 'themes/default/style.css']);
	}
	
	if (cssPath === activeCSS) {
		return;
	}
	
	unloadTheme();
	
	// Load the new style
	let cssFile = Gio.file_new_for_path(cssPath);
	St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(cssFile);
	
	// Force style update.
	actors.forEach(function(actor) {
		actor.grab_key_focus();
	});
	
	activeCSS = cssPath;
}

function unloadTheme() {
	if (activeCSS) {
		LOG('Unload ' + activeCSS);
		
		let cssFile = Gio.file_new_for_path(activeCSS);
		St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(cssFile);
		activeCSS = false;
	}
}

/**
 * callbacks
 */
function updateVisibility() {
	// If we have a window to control, then we show the buttons.
	let visible = !Main.overview.visible;
	if (visible) {
		visible = false;
		let win = Util.getWindow();
		if (win) {
			visible = !win.decorated;
		}
	}
	
	actors.forEach(function(actor, i) {
		if (!boxes[i].get_children().length) {
			return;
		}
		
		if (visible) {
			actor.show();
		} else {
			actor.hide();
		}
	});
	
	return false;
}

/**
 * Subextension hooks
 */
let extensionPath;
function init(extensionMeta) {
	extensionPath = extensionMeta.path;
}

let wmCallbackIDs = [];
let overviewCallbackIDs = [];
let themeCallbackID = 0;

function enable() {
	loadTheme();
	createButtons();
	
	overviewCallbackIDs.push(Main.overview.connect('showing', updateVisibility));
	overviewCallbackIDs.push(Main.overview.connect('hidden', updateVisibility));
	
	let wm = global.window_manager;
	wmCallbackIDs.push(wm.connect('switch-workspace', updateVisibility));
	wmCallbackIDs.push(wm.connect('map', updateVisibility));
	wmCallbackIDs.push(wm.connect('minimize', updateVisibility));
	wmCallbackIDs.push(wm.connect('unminimize', updateVisibility));
	
	wmCallbackIDs = wmCallbackIDs.concat(Util.onSizeChange(updateVisibility));
	

    if (gtk_settings) {
        themeCallbackID = gtk_settings.connect('notify::gtk-theme-name', loadTheme);
    }
}

function disable() {
	wmCallbackIDs.forEach(function(id) {
		global.window_manager.disconnect(id);
	});
	
	overviewCallbackIDs.forEach(function(id) {
		Main.overview.disconnect(id);
	});
	
	wmCallbackIDs = [];
	overviewCallbackIDs = [];
	
	if (themeCallbackID !== 0 && gtk_settings) {
		gtk_settings.disconnect(themeCallbackID);
		themeCallbackID = 0;
	}
	
	destroyButtons();
	unloadTheme();
}

