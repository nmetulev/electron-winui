const automationPrefix = 'ElectronWinUI';

function encodeAutomationToken(value) {
  if (/^[a-z\d][a-z\d._-]*$/i.test(value)) {
    return `Raw.${value}`;
  }
  return `B64.${Buffer.from(value, 'utf8').toString('base64url')}`;
}

function menuItemAutomationId(surface, item, indexPath, usedIds = new Set()) {
  const explicitId =
    typeof item.id === 'string' && item.id.trim() ? item.id : null;
  const explicitAutomationId = explicitId
    ? `${automationPrefix}.${surface}.Item.Id.${encodeAutomationToken(explicitId)}`
    : null;
  const automationId =
    explicitAutomationId && !usedIds.has(explicitAutomationId)
      ? explicitAutomationId
      : `${automationPrefix}.${surface}.Item.Index.${indexPath.join('.')}`;
  usedIds.add(automationId);
  return automationId;
}

function setAutomationProperties(bindings, element, { id, name }) {
  if (id) {
    bindings.AutomationProperties.setAutomationId(element, id);
  }
  if (name) {
    bindings.AutomationProperties.setName(element, name);
  }
}

module.exports = {
  menuItemAutomationId,
  setAutomationProperties,
};
