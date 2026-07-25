// Strongly-typed map of the DOM elements the app drives.

export interface UI {
  app: HTMLDivElement;
  pdfInput: HTMLInputElement;
  viewer: HTMLDivElement;
  pages: HTMLDivElement;
  welcome: HTMLDivElement;
  welcomeOpen: HTMLButtonElement;
  loader: HTMLDivElement;
  loaderText: HTMLElement;
  status: HTMLElement;
  pageLabel: HTMLElement;
  prevPage: HTMLButtonElement;
  nextPage: HTMLButtonElement;
  pageSlider: HTMLInputElement;
  sliderMarks: HTMLDivElement;
  sliderSegs: HTMLDivElement;
  bookmarkMark: HTMLButtonElement;
  viewToggle: HTMLButtonElement;
  viewPopover: HTMLDivElement;
  appearanceTabs: HTMLDivElement;
  presetTiles: HTMLDivElement;
  theme: HTMLSelectElement;
  themePreviews: HTMLDivElement;
  toggleAnnoPanel: HTMLButtonElement;
  railFlyout: HTMLDivElement;
  railFlyoutClose: HTMLButtonElement;
  flyoutTitle: HTMLElement;
  annoTab: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  zoom: HTMLSelectElement;
  zoomIn: HTMLButtonElement;
  dropZone: HTMLDivElement;
  tocDrawer: HTMLElement;
  tocList: HTMLDivElement;
  highlightMode: HTMLButtonElement;
  annoColor: HTMLDivElement;
  noteText: HTMLTextAreaElement;
  deleteAnno: HTMLButtonElement;
  annoList: HTMLDivElement;
  annoSearch: HTMLInputElement;
  annoFilterColors: HTMLDivElement;
  modalTags: HTMLInputElement;
  modalTagSuggest: HTMLDivElement;
  exportAnno: HTMLButtonElement;
  importAnno: HTMLInputElement;
  importAnnoButton: HTMLButtonElement;
  copyCodex: HTMLButtonElement;
  exportMarkdown: HTMLButtonElement;
  doneAll: HTMLInputElement;
  deleteDone: HTMLButtonElement;
  readerMode: HTMLSelectElement;
  voiceSelect: HTMLSelectElement;
  voiceCustom: HTMLInputElement;
  voicePreview: HTMLButtonElement;
  stylePrompt: HTMLTextAreaElement;
  rate: HTMLInputElement;
  rateValue: HTMLElement;
  readPage: HTMLButtonElement;
  readAll: HTMLButtonElement;
  gotoRead: HTMLButtonElement;
  pauseRead: HTMLButtonElement;
  resumeRead: HTMLButtonElement;
  stopRead: HTMLButtonElement;
  apiProvider: HTMLSelectElement;
  apiKey: HTMLInputElement;
  localUrl: HTMLInputElement;
  ttsModel: HTMLSelectElement;
  saveSettings: HTMLButtonElement;
  clearSettings: HTMLButtonElement;
  playerPlay: HTMLButtonElement;
  playerPrev: HTMLButtonElement;
  playerNext: HTMLButtonElement;
  playerGoto: HTMLButtonElement;
  focusToggle: HTMLButtonElement;
  dimToggle: HTMLButtonElement;
  playerVoice: HTMLSelectElement;
  playerRate: HTMLInputElement;
  playerRateValue: HTMLElement;
  annoModal: HTMLDivElement;
  annoModalClose: HTMLButtonElement;
  annoModalMeta: HTMLElement;
  annoModalDot: HTMLElement;
  annoModalQuote: HTMLElement;
  modalColor: HTMLDivElement;
  modalNoteText: HTMLTextAreaElement;
  modalSave: HTMLButtonElement;
  modalDelete: HTMLButtonElement;
  quickNote: HTMLDivElement;
  quickNoteInput: HTMLInputElement;
  coachmark: HTMLDivElement;
  coachmarkDismiss: HTMLButtonElement;
  cmdk: HTMLDivElement;
  cmdkInput: HTMLInputElement;
  cmdkList: HTMLDivElement;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function buildUi(): UI {
  const ids = [
    "app", "pdfInput", "viewer", "pages", "welcome", "welcomeOpen", "loader", "loaderText", "status", "pageLabel", "prevPage", "nextPage", "pageSlider", "sliderMarks", "sliderSegs", "bookmarkMark", "viewToggle", "viewPopover",
    "appearanceTabs", "presetTiles", "theme", "themePreviews", "toggleAnnoPanel", "railFlyout", "railFlyoutClose", "flyoutTitle", "annoTab", "zoomOut", "zoom", "zoomIn", "dropZone",
    "highlightMode", "annoColor", "noteText", "deleteAnno", "annoList", "exportAnno", "importAnno",
    "importAnnoButton", "copyCodex", "exportMarkdown", "doneAll", "deleteDone", "annoSearch", "annoFilterColors", "modalTags", "modalTagSuggest", "tocDrawer", "tocList", "readerMode", "voiceSelect", "voiceCustom", "voicePreview", "stylePrompt",
    "rate", "rateValue", "readPage", "readAll", "gotoRead", "pauseRead", "resumeRead", "stopRead", "apiProvider",
    "apiKey", "localUrl", "ttsModel", "saveSettings", "clearSettings", "playerPlay", "playerPrev", "playerNext", "playerGoto",
    "playerVoice", "playerRate", "playerRateValue", "focusToggle", "dimToggle", "annoModal", "annoModalClose", "annoModalMeta", "annoModalDot", "annoModalQuote",
    "modalColor", "modalNoteText", "modalSave", "modalDelete", "quickNote", "quickNoteInput", "coachmark", "coachmarkDismiss",
    "cmdk", "cmdkInput", "cmdkList"
  ];
  const ui = Object.fromEntries(ids.map((id) => [id, el(id)])) as unknown as UI;
  return ui;
}
