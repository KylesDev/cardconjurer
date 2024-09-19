//checks to see if it needs to run
if (!card.manaSymbols.includes('/js/frames/manaSymbolsCustomKylesMinimalist.js')) {
	card.manaSymbols.push('/js/frames/manaSymbolsCustomKylesMinimalist.js');
}
if (!mana.get('minimalistw')) {
	loadManaSymbols([
		'customKylesMinimalist/minimalistbar.png',
		'customKylesMinimalist/minimalistw.png',
		'customKylesMinimalist/minimalistu.png',
		'customKylesMinimalist/minimalistb.png',
		'customKylesMinimalist/minimalistr.png',
		'customKylesMinimalist/minimalistg.png',
		'customKylesMinimalist/minimalistc.png',
		'customKylesMinimalist/minimalist1.png',
		'customKylesMinimalist/minimalist2.png',
		'customKylesMinimalist/minimalist3.png',
		'customKylesMinimalist/minimalist4.png',
		'customKylesMinimalist/minimalist5.png',
		'customKylesMinimalist/minimalist6.png',
		'customKylesMinimalist/minimalist7.png',
		'customKylesMinimalist/minimalist8.png',
		'customKylesMinimalist/minimalist9.png',
		'customKylesMinimalist/minimalist10.png',
		'customKylesMinimalist/minimalist11.png',
		'customKylesMinimalist/minimalist12.png',
		'customKylesMinimalist/minimalist13.png',
		'customKylesMinimalist/minimalist14.png',
		'customKylesMinimalist/minimalist15.png',
		'customKylesMinimalist/minimalist16.png',
		'customKylesMinimalist/minimalist20.png',
		'customKylesMinimalist/minimalistt.png',
		'customKylesMinimalist/minimalistl.png',
		'customKylesMinimalist/minimaliste.png',
	]);
	console.log('loaded minimalist mana symbols')
}