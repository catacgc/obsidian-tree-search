import React from 'react';

type ControlBarProps = {
	onArchive: () => void;
	onFavourite: () => void;
};

const ControlBar: React.FC<ControlBarProps> = ({ onArchive, onFavourite }) => {
	return (
		<div className="control-bar">
			<button onClick={onArchive} className="control-button">📦</button>
			<button onClick={onFavourite} className="control-button">⭐</button>
		</div>
	);
};

export default ControlBar;
