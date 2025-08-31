//defines available frames
availableFrames = [
	// Creature
	{name:'White Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureW.png'},
	{name:'Blue Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureU.png'},
	{name:'Black Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureB.png'},
	{name:'Red Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureR.png'},
	{name:'Green Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureG.png'},
	{name:'Multicolored Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureM.png'},
	{name:'Artifact Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureA.png'},
	{name:'Vehicle Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureV.png'},

	// Noncreature
	{name:'White Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureW.png'},
	{name:'Blue Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureU.png'},
	{name:'Black Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureB.png'},
	{name:'Red Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureR.png'},
	{name:'Green Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureG.png'},
	{name:'Multicolored Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureM.png'},
	{name:'Artifact Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureA.png'},
	{name:'Vehicle Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureV.png'},

	// Legendary Accents
	{name:'White Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownW.png'},
	{name:'Blue Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownU.png'},
	{name:'Black Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownB.png'},
	{name:'Red Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownR.png'},
	{name:'Green Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownG.png'},
	{name:'Multicolored Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownM.png'},
	{name:'Artifact Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownA.png'},
	{name:'Vehicle Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownV.png'},
];
//disables/enables the "Load Frame Version" button
document.querySelector('#loadFrameVersion').disabled = false;
//defines process for loading this version, if applicable
document.querySelector('#loadFrameVersion').onclick = async function() {
	//resets things so that every frame doesn't have to
	await resetCardIrregularities();
	//sets card version
	card.version = 'bloomburrowBorderlessColored';
	//art bounds
	card.artBounds = {x:0, y:0, width:1, height:2659/2814};
	autoFitArt();
	//set symbol bounds
	card.setSymbolBounds = {x:0.9213, y:1671/2814, width:0.12, height:0.0410, vertical:'center', horizontal: 'right'};
	resetSetSymbol();
	//watermark bounds
	card.watermarkBounds = {x:0.5, y:0.7762, width:0.75, height:0.2305};
	resetWatermark();
	//text
	loadTextOptions({
		mana: {name:'Mana Cost', text:'', y:0.0613, width:0.9292, height:71/2100, oneLine:true, size:71/1638, align:'right', shadowX:-0.001, shadowY:0.0029, manaCost:true, manaSpacing:0},
		title: {name:'Title', text:'', x:0.0854, y:0.0522, width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0381, color:'white'},
		type: {name:'Type', text:'', x:0.0854, y:1602/2814, width:0.8292, height:0.0543, oneLine:true, font:'belerenb', size:0.0324, color:'white'},
		rules: {name:'Rules Text', text:'', x:173/2010, y:1818/2814, width:1664/2010, height:684/2814, size:0.0362, color:'white'},
		pt: {name:'Power/Toughness', text:'', x:1594/2010, y:2546/2814, width:275/2010, height:105/2814, size:0.0372, font:'belerenbsc', oneLine:true, align:'center', color:'white'}
	});
}
//loads available frames
loadFramePack();