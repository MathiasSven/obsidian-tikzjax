import { Plugin, WorkspaceWindow } from 'obsidian';
import { TikzjaxPluginSettings, DEFAULT_SETTINGS, TikzjaxSettingTab } from "./settings";
import { optimize } from "./svgo.browser";
import { v4 as uuidv4 } from 'uuid';

// @ts-ignore
import tikzjaxJs from 'inline:./tikzjax.js';


export default class TikzjaxPlugin extends Plugin {
	settings: TikzjaxPluginSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TikzjaxSettingTab(this.app, this));

		// Support pop-out windows
		this.app.workspace.onLayoutReady(() => {
			this.loadTikZJaxAllWindows();
			this.registerEvent(this.app.workspace.on("window-open", (win, window) => {
				this.loadTikZJax(window.document);
			}));
		});


		this.addSyntaxHighlighting();

		this.registerTikzCodeBlock();
	}

	onunload() {
		this.unloadTikZJaxAllWindows();
		this.removeSyntaxHighlighting();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}


	loadTikZJax(doc: Document) {
		const s = document.createElement("script");
		s.id = "tikzjax";
		s.type = "text/javascript";
		s.innerText = tikzjaxJs;
		doc.body.appendChild(s);


		doc.addEventListener('tikzjax-load-finished', this.postProcessSvg);
	}

	unloadTikZJax(doc: Document) {
		const s = doc.getElementById("tikzjax");
		s.remove();

		doc.removeEventListener("tikzjax-load-finished", this.postProcessSvg);
	}

	loadTikZJaxAllWindows() {
		for (const window of this.getAllWindows()) {
			this.loadTikZJax(window.document);
		}
	}

	unloadTikZJaxAllWindows() {
		for (const window of this.getAllWindows()) {
			this.unloadTikZJax(window.document);
		}
	}

	getAllWindows() {
		// Via https://discord.com/channels/686053708261228577/840286264964022302/991591350107635753

		const windows = [];

		// push the main window's root split to the list
		windows.push(this.app.workspace.rootSplit.win);

		// @ts-ignore floatingSplit is undocumented
		const floatingSplit = this.app.workspace.floatingSplit;
		floatingSplit.children.forEach((child: any) => {
			// if this is a window, push it to the list
			if (child instanceof WorkspaceWindow) {
				windows.push(child.win);
			}
		});

		return windows;
	}


	registerTikzCodeBlock() {
		this.registerMarkdownCodeBlockProcessor("tikz", (source, el, ctx) => {
			const lines = source.split("\n");
			const cssLines: string[] = [];

			// Find the index where the CSS block ends (first non-% line)
			const codeStart = lines.findIndex(line => !line.trimStart().startsWith("%"));
			// If all lines are CSS, codeStart will be -1
			const codeLines = codeStart === -1 ? [] : lines.slice(codeStart);

			for (const line of lines.slice(0, codeStart === -1 ? lines.length : codeStart)) {
				// Remove leading %, any spaces, then trim
				const cssText = line.replace(/^%\s*/, "").trim();
				if (cssText.length > 0) cssLines.push(cssText);
			}

			// Join all CSS chunks, respecting possible semicolons in-line
			const cssString = cssLines.join("; ");

			const cleanedSource = codeLines.join("\n");

			// Create a wrapper div to apply CSS styling
			const wrapper = el.createDiv();
			if (cssString) {
				wrapper.setAttr("style", cssString);
			}

			const script = wrapper.createEl("script");
			script.setAttribute("type", "text/tikz");
			script.setAttribute("data-show-console", "true");

			script.setText(this.tidyTikzSource(cleanedSource));
		});
	}


	addSyntaxHighlighting() {
		// @ts-ignore
		window.CodeMirror.modeInfo.push({name: "Tikz", mime: "text/x-latex", mode: "stex"});
	}

	removeSyntaxHighlighting() {
		// @ts-ignore
		window.CodeMirror.modeInfo = window.CodeMirror.modeInfo.filter(el => el.name != "Tikz");
	}

	tidyTikzSource(tikzSource: string) {

		// Remove non-breaking space characters, otherwise we get errors
		const remove = "&nbsp;";
		tikzSource = tikzSource.replaceAll(remove, "");


		let lines = tikzSource.split("\n");

		// Trim whitespace that is inserted when pasting in code, otherwise TikZJax complains
		lines = lines.map(line => line.trim());

		// Remove empty lines
		lines = lines.filter(line => line);


		return lines.join("\n");
	}


	colorSVGinDarkMode(svg: string) {
		// Replace the color "black" with currentColor (the current text color)
		// so that diagram axes, etc are visible in dark mode
		// And replace "white" with the background color

		svg = svg.replaceAll(/("#000"|"black")/g, `"currentColor"`)
				.replaceAll(/("#fff"|"white")/g, `"var(--background-primary)"`);

		return svg;
	}


	optimizeSVG(svg: string) {
		// Optimize the SVG using SVGO
		// Fixes misaligned text nodes on mobile

		return optimize(svg, {plugins:
			[
				{
					name: 'preset-default',
					params: {
						overrides: {
							// Don't use the "cleanupIDs" plugin
							// To avoid problems with duplicate IDs ("a", "b", ...)
							// when inlining multiple svgs with IDs
							cleanupIDs: false
						}
					}
				}
			]
		// @ts-ignore
		}).data;
	}

	isolateIds(svgEl: HTMLElement): void {
		const elementsWithIds = svgEl.querySelectorAll<HTMLElement>('[id]');
		for (let element of elementsWithIds) {
			let oldId = element.id;
			let newId = uuidv4();

			svgEl.innerHTML = svgEl.innerHTML.replaceAll(oldId, newId);
		}
	}

	postProcessSvg = (e: Event) => {

		const svgEl = e.target as HTMLElement;

		this.isolateIds(svgEl);

		let svg = svgEl.outerHTML;

		if (this.settings.invertColorsInDarkMode) {
			svg = this.colorSVGinDarkMode(svg);
		}

		svg = this.optimizeSVG(svg);

		svgEl.outerHTML = svg;
	}
}

