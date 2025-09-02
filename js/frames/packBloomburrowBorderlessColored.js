//Create objects for common properties across available frames
var creatureMasks = [{src:'/img/frames/custom/bloomburrowBorderlessColored/creaturePinlineMask.png', name:'Pinline'}];
var noncreatureMasks = [{src:'/img/frames/custom/bloomburrowBorderlessColored/noncreaturePinlineMask.png', name:'Pinline'}];
//defines available frames
availableFrames = [
	// Creature
	{name:'White Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureW.png',masks:creatureMasks},
	{name:'Blue Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureU.png',masks:creatureMasks},
	{name:'Black Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureB.png',masks:creatureMasks},
	{name:'Red Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureR.png',masks:creatureMasks},
	{name:'Green Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureG.png',masks:creatureMasks},
	{name:'Multicolored Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureM.png',masks:creatureMasks},
	{name:'Artifact Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureA.png',masks:creatureMasks},
	{name:'Colorless Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureC.png',masks:creatureMasks},
	{name:'Vehicle Creature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/creatureV.png',masks:creatureMasks},

	// Noncreature
	{name:'White Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureW.png', masks:noncreatureMasks},
	{name:'Blue Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureU.png', masks:noncreatureMasks},
	{name:'Black Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureB.png', masks:noncreatureMasks},
	{name:'Red Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureR.png', masks:noncreatureMasks},
	{name:'Green Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureG.png', masks:noncreatureMasks},
	{name:'Multicolored Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureM.png', masks:noncreatureMasks},
	{name:'Artifact Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureA.png', masks:noncreatureMasks},
	{name:'Colorless Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureC.png', masks:noncreatureMasks},
	{name:'Vehicle Noncreature Frame', src:'/img/frames/custom/bloomburrowBorderlessColored/noncreatureV.png', masks:noncreatureMasks},

	// Legendary Accents
	{name:'White Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownW.png'},
	{name:'Blue Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownU.png'},
	{name:'Black Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownB.png'},
	{name:'Red Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownR.png'},
	{name:'Green Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownG.png'},
	{name:'Multicolored Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownM.png'},
	{name:'Artifact Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownA.png'},
	{name:'Colorless Legendary Accents', src:'/img/frames/custom/bloomburrowBorderlessColored/crownC.png'},
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