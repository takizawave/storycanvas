export const stories = [
  ['accordion--default', 'Disclosure/Accordion', 'Default'],
  ['accordion--multiple', 'Disclosure/Accordion', 'Multiple'],
  ['accordion--disabled', 'Disclosure/Accordion', 'Disabled'],
  ['button--primary', 'Forms/Button', 'Primary'],
  ['button--secondary', 'Forms/Button', 'Secondary'],
  ['button--disabled', 'Forms/Button', 'Disabled'],
  ['button--sizes', 'Forms/Button', 'Sizes'],
  ['input--default', 'Forms/Input', 'Default'],
  ['input--invalid', 'Forms/Input', 'Invalid'],
  ['input--disabled', 'Forms/Input', 'Disabled'],
  ['badge--default', 'Data display/Badge', 'Default'],
  ['badge--subtle', 'Data display/Badge', 'Subtle'],
  ['badge--outline', 'Data display/Badge', 'Outline'],
  ['alert--info', 'Feedback/Alert', 'Info'],
  ['alert--success', 'Feedback/Alert', 'Success'],
  ['alert--error', 'Feedback/Alert', 'Error'],
  ['tabs--default', 'Navigation/Tabs', 'Default'],
  ['tabs--pills', 'Navigation/Tabs', 'Pills'],
].map(([id, title, name]) => ({ id, title, name, type: 'story', importPath: './fixture.stories.js' }));

export const index = {
  v: 5,
  entries: Object.fromEntries([
    ...stories.map(story => [story.id, story]),
    ['forms-button--docs', { id: 'forms-button--docs', title: 'Forms/Button', name: 'Docs', type: 'docs' }],
  ]),
};
