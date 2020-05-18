import React from 'react';
import PropTypes from 'prop-types';

const TestButton = ({ greetings }) => <button>{greetings}</button>;
TestButton.propTypes = { greetings: PropTypes.string };
TestButton.defaultProps = { greetings: 'Hello Button' };

export default { title: 'Button' };

export const Text = () => <TestButton />;