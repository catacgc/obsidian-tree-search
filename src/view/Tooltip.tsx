import React, { useState } from 'react';

type TooltipProps = {
	text: string;
	children: React.ReactNode;
};

const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
	const [visible, setVisible] = useState(false);

	return (
		<div
			className="tooltip-container"
			onMouseEnter={() => setVisible(true)}
			onMouseLeave={() => setVisible(false)}
		>
			{children}
			{visible && <div className="tree-search-tooltip">{text}</div>}
		</div>
	);
};

export default Tooltip;
