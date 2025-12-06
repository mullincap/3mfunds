from flask import Flask, render_template

app = Flask(__name__)

#dashboards
@app.route('/')
@app.route('/index')
def index():
    return render_template('components/dashboards/index.html')


if __name__ == '__main__':
    app.run(debug=True)
