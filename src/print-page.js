document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-payment-tab]");
  if (!tab) return;

  const group = tab.closest("[data-payment-tabs]");
  if (!group) return;

  const selected = tab.dataset.paymentTab;
  for (const button of group.querySelectorAll("[data-payment-tab]")) {
    button.setAttribute("aria-selected", String(button.dataset.paymentTab === selected));
  }

  for (const panel of group.querySelectorAll("[data-payment-panel]")) {
    panel.hidden = panel.dataset.paymentPanel !== selected;
  }
});
