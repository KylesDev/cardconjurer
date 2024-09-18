//Create objects for common properties across available frames
var masks = [];
var bounds = {x:0.7573, y:0.8848, width:0.188, height:0.0733};
//defines available frames
availableFrames = [
	{name:'Animation Frame', src:'/img/frames/custom/kyles/frames/animation/animation_frame.png', masks:masks},

];
//disables/enables the "Load Frame Version" button
document.querySelector('#loadFrameVersion').disabled = false;
//defines process for loading this version, if applicable
document.querySelector('#loadFrameVersion').onclick = async function() {
	//resets things so that every frame doesn't have to
	await resetCardIrregularities();
	//sets card version
	card.version = 'customKylesAnimation';


	loadScript('/js/frames/manaSymbolsCustomKylesAnimation.js');

	//art bounds
	card.artBounds = {x:0, y:0, width:1, height:1};
	autoFitArt();
	//set symbol bounds
	card.setSymbolBounds = {x:0.9213, y:0.5910, width:0.12, height:0.0410, vertical:'center', horizontal: 'right'};
	resetSetSymbol();
	//watermark bounds
	card.watermarkBounds = {x:0.5, y:0.7762, width:0.75, height:0.2305};
	resetWatermark();
	//text
	loadTextOptions({
		mana: {name:'Mana Cost', text:'', y:0.0643, width:0.9442, height:71/2100, oneLine:true, size:71/1638, align:'right',  manaCost:true, manaSpacing:0, manaPrefix:'kylesAnimation'},
		title: {name:'Title', text:'', x:0.0573, y:0.0532, width:0.7533, height:0.0543, oneLine:true, font:'belerenb', size:0.0381},
		type: {name:'Type', text:'', x:0.0573, y:0.875, width:0.69, height:0.046, oneLine:true, font:'belerenb', size:0.0324},
		rules: {name:'Rules Text', text:'', x:0.2, y:0.62, width:0.70, height:0.215, size:0.0362},
		pt: {name:'Power/Toughness', text:'', x:0.77, y:0.875, width:0.18, height:0.046, size:0.0372, font:'belerenbsc', oneLine:true, align:'center'}
	});
}
//loads available frames
loadFramePack();
//Only for the main version as the webpage loads:
if (!card.text) {
	document.querySelector('#loadFrameVersion').click();
}