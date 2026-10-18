import React from 'react';

export default class DataPanelBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="overlay"><div className="sheet"><div className="sheet-body">
      <h3>Не удалось открыть данные приложения</h3>
      <p role="alert">{this.state.error.message || 'Ошибка отображения'}</p>
      <p>Договоры и резервные копии сохранены. Закройте это окно, чтобы вернуться к работе.</p>
      <button className="btn primary" onClick={this.props.onClose}>Закрыть</button>
    </div></div></div>;
  }
}
