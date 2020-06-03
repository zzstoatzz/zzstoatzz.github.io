window.onload = function () {
    $("#mood").val("major");
    $("#root").val("C");
    var month = new Date().toLocaleString('default', { month: 'long' })
    $("#month").text(month.concat("'s Shout Out"));
}
function changeImg() {
    var root = $("#root option:selected").val();
    var mood = $("#mood option:selected").val();
    var newImg = "imgs/keys/".concat(root," ", mood,".png");
    document.getElementById("board").src = newImg;
}