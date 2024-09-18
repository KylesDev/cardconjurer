//checks to see if it needs to run
if (!card.manaSymbols.includes('/js/frames/manaSymbolsCustomKylesAnimation.js')) {
	card.manaSymbols.push('/js/frames/manaSymbolsCustomKylesAnimation.js');
}
if (!mana.get('kylesAnimationw')) {
	loadManaSymbols([
		'customKyles/kylesAnimation1',
		'customKyles/kylesAnimation2',
		'customKyles/kylesAnimation3',
		'customKyles/kylesAnimation4',
		'customKyles/kylesAnimation5',
		'customKyles/kylesAnimation6',
		'customKyles/kylesAnimation7',
		'customKyles/kylesAnimation8',
		'customKyles/kylesAnimation9',
		'customKyles/kylesAnimation12',
		'customKyles/kylesAnimationw',
		'customKyles/kylesAnimationu',
		'customKyles/kylesAnimationb',
		'customKyles/kylesAnimationr',
		'customKyles/kylesAnimationg',
		'customKyles/kylesAnimationc',
	]);
}